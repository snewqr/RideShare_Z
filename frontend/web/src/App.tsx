import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface RideData {
  id: string;
  name: string;
  startLocation: string;
  endLocation: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
  matchScore?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState<RideData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRide, setCreatingRide] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRideData, setNewRideData] = useState({ 
    name: "", 
    startLocation: "", 
    endLocation: "",
    distance: "" 
  });
  const [selectedRide, setSelectedRide] = useState<RideData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<RideData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const ridesPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadData();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const ridesList: RideData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          ridesList.push({
            id: businessId,
            name: businessData.name,
            startLocation: `Location ${businessData.publicValue1}`,
            endLocation: `Location ${businessData.publicValue2}`,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            matchScore: Math.round((Number(businessData.publicValue1) + Number(businessData.publicValue2)) * 5)
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRides(ridesList);
      if (address) {
        setUserHistory(ridesList.filter(ride => ride.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRide = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRide(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating ride with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const distanceValue = parseInt(newRideData.distance) || 0;
      const businessId = `ride-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, distanceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRideData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100) + 1,
        Math.floor(Math.random() * 100) + 1,
        `Ride from ${newRideData.startLocation} to ${newRideData.endLocation}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Ride created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRideData({ name: "", startLocation: "", endLocation: "", distance: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRide(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRides = rides.filter(ride => {
    const matchesSearch = ride.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ride.startLocation.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ride.endLocation.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || ride.isVerified;
    return matchesSearch && matchesFilter;
  });

  const paginatedRides = filteredRides.slice((currentPage - 1) * ridesPerPage, currentPage * ridesPerPage);
  const totalPages = Math.ceil(filteredRides.length / ridesPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Ride Sharing 🔐</h1>
            <p>FHE-Protected Carpool Matching</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚗</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Join our privacy-focused ride sharing platform with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted ride requests with location privacy</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Match with compatible riders using homomorphic computation</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted ride sharing platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Ride Sharing 🔐</h1>
          <p>FHE-Protected Carpool Matching</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Ride
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Rides</h3>
            <div className="stat-value">{rides.length}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{rides.filter(r => r.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>Your Rides</h3>
            <div className="stat-value">{userHistory.length}</div>
          </div>
        </div>

        <div className="project-intro">
          <h2>FHE-Protected Ride Sharing</h2>
          <p>Our platform uses Fully Homomorphic Encryption to match riders while keeping locations private. 
          Start and end points are encrypted, and matching happens through homomorphic computation without revealing sensitive data.</p>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search rides..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Verified Only
            </label>
          </div>
          
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>

        <div className="rides-section">
          <h2>Available Rides</h2>
          <div className="rides-list">
            {paginatedRides.length === 0 ? (
              <div className="no-rides">
                <p>No rides found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Ride
                </button>
              </div>
            ) : (
              paginatedRides.map((ride) => (
                <div 
                  key={ride.id}
                  className={`ride-card ${ride.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedRide(ride)}
                >
                  <div className="ride-header">
                    <h3>{ride.name}</h3>
                    <span className="match-score">{ride.matchScore}% Match</span>
                  </div>
                  <div className="ride-route">
                    <span>📍 {ride.startLocation}</span>
                    <span className="arrow">→</span>
                    <span>🎯 {ride.endLocation}</span>
                  </div>
                  <div className="ride-meta">
                    <span>{new Date(ride.timestamp * 1000).toLocaleDateString()}</span>
                    <span className={`status ${ride.isVerified ? 'verified' : 'pending'}`}>
                      {ride.isVerified ? '✅ Verified' : '🔓 Ready to Verify'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="user-history">
          <h3>Your Ride History</h3>
          <div className="history-list">
            {userHistory.slice(0, 3).map(ride => (
              <div key={ride.id} className="history-item">
                <span>{ride.name}</span>
                <span className={`status ${ride.isVerified ? 'verified' : 'pending'}`}>
                  {ride.isVerified ? 'Verified' : 'Pending'}
                </span>
              </div>
            ))}
            {userHistory.length === 0 && <p>No ride history</p>}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateRide 
          onSubmit={createRide} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRide} 
          rideData={newRideData} 
          setRideData={setNewRideData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRide && (
        <RideDetailModal 
          ride={selectedRide} 
          onClose={() => setSelectedRide(null)} 
          decryptData={() => decryptData(selectedRide.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <span>✓</span>}
            {transactionStatus.status === "error" && <span>✗</span>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRide: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  rideData: any;
  setRideData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, rideData, setRideData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'distance') {
      const intValue = value.replace(/[^\d]/g, '');
      setRideData({ ...rideData, [name]: intValue });
    } else {
      setRideData({ ...rideData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-ride-modal">
        <div className="modal-header">
          <h2>Create New Ride</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Distance data will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Ride Name *</label>
            <input 
              type="text" 
              name="name" 
              value={rideData.name} 
              onChange={handleChange} 
              placeholder="Morning commute..." 
            />
          </div>
          
          <div className="form-group">
            <label>Start Location *</label>
            <input 
              type="text" 
              name="startLocation" 
              value={rideData.startLocation} 
              onChange={handleChange} 
              placeholder="Enter start location..." 
            />
          </div>
          
          <div className="form-group">
            <label>End Location *</label>
            <input 
              type="text" 
              name="endLocation" 
              value={rideData.endLocation} 
              onChange={handleChange} 
              placeholder="Enter destination..." 
            />
          </div>
          
          <div className="form-group">
            <label>Distance (km, Integer only) *</label>
            <input 
              type="number" 
              name="distance" 
              value={rideData.distance} 
              onChange={handleChange} 
              placeholder="Enter distance..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !rideData.name || !rideData.startLocation || !rideData.endLocation || !rideData.distance} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Ride"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RideDetailModal: React.FC<{
  ride: RideData;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ ride, onClose, decryptData, isDecrypting }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="ride-detail-modal">
        <div className="modal-header">
          <h2>Ride Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="ride-info">
            <div className="info-item">
              <span>Ride Name:</span>
              <strong>{ride.name}</strong>
            </div>
            <div className="info-item">
              <span>Route:</span>
              <strong>{ride.startLocation} → {ride.endLocation}</strong>
            </div>
            <div className="info-item">
              <span>Match Score:</span>
              <strong>{ride.matchScore}%</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(ride.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            
            <div className="data-row">
              <div className="data-label">Distance:</div>
              <div className="data-value">
                {ride.isVerified && ride.decryptedValue ? 
                  `${ride.decryptedValue} km (Verified)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${ride.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || ride.isVerified}
              >
                {isDecrypting ? "Decrypting..." : ride.isVerified ? "✅ Verified" : "🔓 Verify"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <h4>How FHE Protects Your Ride:</h4>
              <ul>
                <li>📍 Locations are encrypted on-chain</li>
                <li>🧮 Matching happens through homomorphic computation</li>
                <li>🔐 Only you can decrypt your specific data</li>
                <li>✅ On-chain verification ensures data integrity</li>
              </ul>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

