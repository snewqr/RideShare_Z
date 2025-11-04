pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RideShareZ is ZamaEthereumConfig {
    struct EncryptedLocation {
        euint32 encryptedLatitude;
        euint32 encryptedLongitude;
    }

    struct RideRequest {
        address rider;
        EncryptedLocation pickup;
        EncryptedLocation destination;
        uint256 timestamp;
        bool matched;
    }

    struct Driver {
        address driverAddress;
        EncryptedLocation currentLocation;
        uint256 capacity;
        uint256 timestamp;
    }

    mapping(uint256 => RideRequest) public rideRequests;
    mapping(address => Driver) public drivers;
    mapping(address => bool) public isActiveDriver;

    uint256 public nextRideId = 1;
    uint256 public constant MATCH_THRESHOLD = 100; // Homomorphic distance threshold

    event RideRequested(uint256 indexed rideId, address indexed rider);
    event DriverRegistered(address indexed driver);
    event RideMatched(uint256 indexed rideId, address indexed driver);

    constructor() ZamaEthereumConfig() {
        // Initialize FHE context
    }

    function requestRide(
        externalEuint32 encryptedPickupLat,
        bytes calldata pickupLatProof,
        externalEuint32 encryptedPickupLon,
        bytes calldata pickupLonProof,
        externalEuint32 encryptedDestLat,
        bytes calldata destLatProof,
        externalEuint32 encryptedDestLon,
        bytes calldata destLonProof
    ) external {
        // Validate encrypted inputs
        require(FHE.isInitialized(FHE.fromExternal(encryptedPickupLat, pickupLatProof)), "Invalid pickup latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPickupLon, pickupLonProof)), "Invalid pickup longitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedDestLat, destLatProof)), "Invalid destination latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedDestLon, destLonProof)), "Invalid destination longitude");

        // Create ride request
        rideRequests[nextRideId] = RideRequest({
            rider: msg.sender,
            pickup: EncryptedLocation({
                encryptedLatitude: FHE.fromExternal(encryptedPickupLat, pickupLatProof),
                encryptedLongitude: FHE.fromExternal(encryptedPickupLon, pickupLonProof)
            }),
            destination: EncryptedLocation({
                encryptedLatitude: FHE.fromExternal(encryptedDestLat, destLatProof),
                encryptedLongitude: FHE.fromExternal(encryptedDestLon, destLonProof)
            }),
            timestamp: block.timestamp,
            matched: false
        });

        // Allow contract to use encrypted values
        FHE.allowThis(rideRequests[nextRideId].pickup.encryptedLatitude);
        FHE.allowThis(rideRequests[nextRideId].pickup.encryptedLongitude);
        FHE.allowThis(rideRequests[nextRideId].destination.encryptedLatitude);
        FHE.allowThis(rideRequests[nextRideId].destination.encryptedLongitude);

        emit RideRequested(nextRideId, msg.sender);
        nextRideId++;
    }

    function registerDriver(
        externalEuint32 encryptedCurrentLat,
        bytes calldata latProof,
        externalEuint32 encryptedCurrentLon,
        bytes calldata lonProof,
        uint256 capacity
    ) external {
        require(!isActiveDriver[msg.sender], "Driver already registered");
        require(FHE.isInitialized(FHE.fromExternal(encryptedCurrentLat, latProof)), "Invalid latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedCurrentLon, lonProof)), "Invalid longitude");

        drivers[msg.sender] = Driver({
            driverAddress: msg.sender,
            currentLocation: EncryptedLocation({
                encryptedLatitude: FHE.fromExternal(encryptedCurrentLat, latProof),
                encryptedLongitude: FHE.fromExternal(encryptedCurrentLon, lonProof)
            }),
            capacity: capacity,
            timestamp: block.timestamp
        });

        FHE.allowThis(drivers[msg.sender].currentLocation.encryptedLatitude);
        FHE.allowThis(drivers[msg.sender].currentLocation.encryptedLongitude);

        isActiveDriver[msg.sender] = true;
        emit DriverRegistered(msg.sender);
    }

    function findMatch(uint256 rideId) external {
        require(rideRequests[rideId].rider != address(0), "Ride request does not exist");
        require(!rideRequests[rideId].matched, "Ride already matched");

        address bestDriver = address(0);
        uint256 bestDistance = type(uint256).max;

        for (uint256 i = 0; i < nextRideId; i++) {
            if (isActiveDriver[address(i)]) {
                uint256 distance = calculateDistance(
                    rideRequests[rideId].pickup,
                    drivers[address(i)].currentLocation
                );

                if (distance < bestDistance && distance < MATCH_THRESHOLD) {
                    bestDistance = distance;
                    bestDriver = address(i);
                }
            }
        }

        if (bestDriver != address(0)) {
            rideRequests[rideId].matched = true;
            emit RideMatched(rideId, bestDriver);
        }
    }

    function calculateDistance(EncryptedLocation memory loc1, EncryptedLocation memory loc2) public returns (uint256) {
        // Homomorphic distance calculation
        euint32 latDiff = FHE.sub(loc1.encryptedLatitude, loc2.encryptedLatitude);
        euint32 lonDiff = FHE.sub(loc1.encryptedLongitude, loc2.encryptedLongitude);

        euint32 latSq = FHE.mul(latDiff, latDiff);
        euint32 lonSq = FHE.mul(lonDiff, lonDiff);

        euint32 sumSq = FHE.add(latSq, lonSq);
        return FHE.decrypt(sumSq);
    }

    function updateDriverLocation(
        externalEuint32 encryptedNewLat,
        bytes calldata latProof,
        externalEuint32 encryptedNewLon,
        bytes calldata lonProof
    ) external {
        require(isActiveDriver[msg.sender], "Not an active driver");
        require(FHE.isInitialized(FHE.fromExternal(encryptedNewLat, latProof)), "Invalid latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedNewLon, lonProof)), "Invalid longitude");

        drivers[msg.sender].currentLocation.encryptedLatitude = FHE.fromExternal(encryptedNewLat, latProof);
        drivers[msg.sender].currentLocation.encryptedLongitude = FHE.fromExternal(encryptedNewLon, lonProof);
        drivers[msg.sender].timestamp = block.timestamp;

        FHE.allowThis(drivers[msg.sender].currentLocation.encryptedLatitude);
        FHE.allowThis(drivers[msg.sender].currentLocation.encryptedLongitude);
    }

    function cancelRide(uint256 rideId) external {
        require(rideRequests[rideId].rider == msg.sender, "Only rider can cancel");
        require(!rideRequests[rideId].matched, "Cannot cancel matched ride");

        delete rideRequests[rideId];
    }

    function getRideStatus(uint256 rideId) external view returns (bool) {
        return rideRequests[rideId].matched;
    }

    function getDriverStatus(address driver) external view returns (bool) {
        return isActiveDriver[driver];
    }
}

