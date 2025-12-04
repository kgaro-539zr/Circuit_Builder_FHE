pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CircuitBuilderFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error RateLimited();
    error BatchClosed();
    error BatchFull();
    error InvalidBatch();
    error StaleWrite();
    error InvalidState();
    error ReplayAttempt();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused();
    event Unpaused();
    event CooldownUpdated(uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event Submission(
        address indexed submitter,
        uint256 indexed batchId,
        bytes32 encryptedSubmission
    );
    event DecryptionRequested(
        uint256 indexed requestId,
        uint256 indexed batchId,
        bytes32 stateHash
    );
    event DecryptionComplete(
        uint256 indexed requestId,
        uint256 indexed batchId,
        uint256 score
    );

    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    uint256 public modelVersion;

    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastActionAt;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct Batch {
        bool isOpen;
        uint256 submissionCount;
        mapping(uint256 => euint32) submissions;
        euint32 accumulator;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    modifier onlyOwner() {
        if (msg.sender != owner()) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier rateLimited() {
        if (block.timestamp < lastActionAt[msg.sender] + cooldownSeconds) {
            revert RateLimited();
        }
        lastActionAt[msg.sender] = block.timestamp;
        _;
    }

    constructor() {
        cooldownSeconds = 30;
        modelVersion = 1;
        _openNewBatch();
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        cooldownSeconds = newCooldown;
        emit CooldownUpdated(newCooldown);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function openNewBatch() external onlyOwner {
        _openNewBatch();
    }

    function closeCurrentBatch() external onlyOwner {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        batches[currentBatchId].isOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedCircuit(
        euint32 encryptedScore
    ) external onlyProvider whenNotPaused rateLimited {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        if (batches[currentBatchId].submissionCount >= 100) revert BatchFull();

        uint256 idx = batches[currentBatchId].submissionCount;
        batches[currentBatchId].submissions[idx] = encryptedScore;
        batches[currentBatchId].submissionCount++;

        // Update accumulator
        euint32 currentAcc = batches[currentBatchId].accumulator;
        if (!FHE.isInitialized(currentAcc)) {
            batches[currentBatchId].accumulator = encryptedScore;
        } else {
            batches[currentBatchId].accumulator = FHE.add(
                currentAcc,
                encryptedScore
            );
        }

        emit Submission(
            msg.sender,
            currentBatchId,
            FHE.toBytes32(encryptedScore)
        );
    }

    function requestBatchScoreDecryption(uint256 batchId)
        external
        onlyProvider
        whenNotPaused
        rateLimited
    {
        if (batchId != currentBatchId) revert InvalidBatch();
        if (batches[batchId].submissionCount == 0) revert InvalidBatch();

        euint32 acc = batches[batchId].accumulator;
        _requireInitialized(acc, "Accumulator not initialized");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(acc);
        bytes32 stateHash = _hashCiphertexts(cts);

        uint256 requestId = FHE.requestDecryption(
            cts,
            this.onScoreDecrypted.selector
        );

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function onScoreDecrypted(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        DecryptionContext memory ctx = decryptionContexts[requestId];
        euint32 currentAcc = batches[ctx.batchId].accumulator;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(currentAcc);
        bytes32 currHash = _hashCiphertexts(cts);

        if (currHash != ctx.stateHash) revert InvalidState();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 score = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;

        emit DecryptionComplete(requestId, ctx.batchId, score);
    }

    function _openNewBatch() internal {
        currentBatchId++;
        batches[currentBatchId].isOpen = true;
        batches[currentBatchId].submissionCount = 0;
        batches[currentBatchId].accumulator = FHE.asEuint32(0);
        emit BatchOpened(currentBatchId);
    }

    function _hashCiphertexts(bytes32[] memory cts)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal returns (euint32) {
        if (!FHE.isInitialized(x)) {
            return FHE.asEuint32(0);
        }
        return x;
    }

    function _requireInitialized(euint32 x, string memory tag) internal pure {
        if (!FHE.isInitialized(x)) {
            revert(string(abi.encodePacked(tag, " not initialized")));
        }
    }
}