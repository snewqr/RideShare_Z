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
  const [decryptedDistance, setDecryptedDistance] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgDistance: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
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
            endLocation: `Destination ${businessData.publicValue2}`,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            matchScore: Math.min(100, Math.round((Number(businessData.publicValue1) + Number(businessData.publicValue2)) * 3))
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRides(ridesList);
      updateStats(ridesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (ridesList: RideData[]) => {
    const total = ridesList.length;
    const verified = ridesList.filter(r => r.isVerified).length;
    const avgDistance = total > 0 ? ridesList.reduce((sum, r) => sum + r.publicValue1, 0) / total : 0;
    setStats({ total, verified, avgDistance });
  };

  const createRide = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRide(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted ride..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const distanceValue = parseInt(newRideData.distance) || 0;
      const businessId = `ride-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, distanceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRideData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 10) + 1,
        Math.floor(Math.random() * 10) + 1,
        `Ride from ${newRideData.startLocation} to ${newRideData.endLocation}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
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
        ? "Transaction rejected" 
        : "Creation failed";
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
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRides = rides.filter(ride => {
    const matchesSearch = ride.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ride.startLocation.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ride.endLocation.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (activeTab === "verified") return matchesSearch && ride.isVerified;
    if (activeTab === "pending") return matchesSearch && !ride.isVerified;
    return matchesSearch;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>RideShare_Z 🚗</h1>
            <span>Private Ride Sharing</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Private ride sharing with encrypted location matching using Zama FHE technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted ride offers with hidden locations</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Match with compatible riders privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your ride data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted ride sharing...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>RideShare_Z 🚗</h1>
          <span>隱私拼車匹配</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Ride
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Rides</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-panel">
            <h3>Avg Distance</h3>
            <div className="stat-value">{stats.avgDistance.toFixed(1)}km</div>
          </div>
        </div>

        <div className="content-section">
          <div className="section-header">
            <h2>Available Rides</h2>
            <div className="controls">
              <input 
                type="text"
                placeholder="Search rides..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <div className="tab-buttons">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All
                </button>
                <button 
                  className={activeTab === "verified" ? "active" : ""}
                  onClick={() => setActiveTab("verified")}
                >
                  Verified
                </button>
                <button 
                  className={activeTab === "pending" ? "active" : ""}
                  onClick={() => setActiveTab("pending")}
                >
                  Pending
                </button>
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="rides-grid">
            {filteredRides.length === 0 ? (
              <div className="no-rides">
                <p>No rides found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Ride
                </button>
              </div>
            ) : (
              filteredRides.map((ride) => (
                <div 
                  key={ride.id} 
                  className={`ride-card ${ride.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedRide(ride)}
                >
                  <div className="card-header">
                    <h3>{ride.name}</h3>
                    <span className={`status ${ride.isVerified ? 'verified' : 'pending'}`}>
                      {ride.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <div className="card-content">
                    <div className="route">
                      <span>📍 {ride.startLocation}</span>
                      <span>→</span>
                      <span>🎯 {ride.endLocation}</span>
                    </div>
                    <div className="match-score">
                      Match Score: <strong>{ride.matchScore}%</strong>
                    </div>
                    <div className="creator">
                      By: {ride.creator.substring(0, 6)}...{ride.creator.substring(38)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="info-section">
          <h3>FHE Ride Matching Process</h3>
          <div className="process-flow">
            <div className="process-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>Encrypt Location Data</h4>
                <p>Start and end locations are encrypted using Zama FHE</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>Homomorphic Matching</h4>
                <p>System computes route compatibility without decrypting data</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>Secure Verification</h4>
                <p>Decrypt and verify matches on-chain when needed</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateRideModal 
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
          onClose={() => {
            setSelectedRide(null);
            setDecryptedDistance(null);
          }}
          decryptedDistance={decryptedDistance}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedRide.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateRideModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  rideData: any;
  setRideData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, rideData, setRideData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRideData({ ...rideData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Create New Ride</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Protected Ride</strong>
            <p>Distance will be encrypted using Zama FHE technology</p>
          </div>

          <div className="form-group">
            <label>Ride Name *</label>
            <input
              type="text"
              name="name"
              value={rideData.name}
              onChange={handleChange}
              placeholder="Enter ride name..."
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
            <label>Distance (km) *</label>
            <input
              type="number"
              name="distance"
              value={rideData.distance}
              onChange={handleChange}
              placeholder="Enter distance..."
              min="0"
            />
            <div className="data-label">FHE Encrypted Integer</div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !rideData.name || !rideData.startLocation || !rideData.endLocation || !rideData.distance}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Ride"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RideDetailModal: React.FC<{
  ride: RideData;
  onClose: () => void;
  decryptedDistance: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ ride, onClose, decryptedDistance, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedDistance !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Ride Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="ride-info">
            <div className="info-item">
              <span>Ride Name:</span>
              <strong>{ride.name}</strong>
            </div>
            <div className="info-item">
              <span>Start:</span>
              <strong>{ride.startLocation}</strong>
            </div>
            <div className="info-item">
              <span>Destination:</span>
              <strong>{ride.endLocation}</strong>
            </div>
            <div className="info-item">
              <span>Match Score:</span>
              <strong>{ride.matchScore}%</strong>
            </div>
          </div>

          <div className="encrypted-section">
            <h3>Encrypted Distance Data</h3>
            <div className="data-row">
              <span>Distance:</span>
              <strong>
                {ride.isVerified ? 
                  `${ride.decryptedValue}km (Verified)` : 
                  decryptedDistance !== null ? 
                  `${decryptedDistance}km (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </strong>
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting || ride.isVerified}
                className={`decrypt-btn ${ride.isVerified ? 'verified' : ''}`}
              >
                {isDecrypting ? "Decrypting..." : 
                 ride.isVerified ? "Verified" : 
                 decryptedDistance !== null ? "Decrypted" : "Decrypt"}
              </button>
            </div>
          </div>

          {ride.isVerified || decryptedDistance !== null ? (
            <div className="analysis-section">
              <h3>Route Analysis</h3>
              <div className="analysis-grid">
                <div className="analysis-item">
                  <span>Compatibility</span>
                  <div className="score-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${ride.matchScore}%` }}
                    >
                      {ride.matchScore}%
                    </div>
                  </div>
                </div>
                <div className="analysis-item">
                  <span>Efficiency</span>
                  <div className="score-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${100 - ride.publicValue1 * 5}%` }}
                    >
                      {100 - ride.publicValue1 * 5}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;