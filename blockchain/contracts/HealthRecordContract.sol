// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title  HealthRecordContract
 * @notice Immutable registry for patient health-record integrity hashes and
 *         provider access permissions, deployed on a local Ganache / Hardhat
 *         test network for academic demonstration purposes.
 *
 * @dev Architecture note (acknowledged limitation):
 *      The backend Express server wallet acts as the single trusted "owner"
 *      and is the only caller of all state-changing functions.  Patient
 *      identity is represented by their MongoDB ObjectId string so no
 *      per-patient Ethereum wallet is required.  This is the well-known
 *      "trusted-oracle" pattern — it is intentionally permissioned rather
 *      than fully decentralised, which is an accepted trade-off for this
 *      academic project.
 *
 *      What IS decentralised / tamper-evident:
 *        - Once a record hash is written it cannot be altered or deleted.
 *        - Every write (addRecord, grantAccess, revokeAccess) is permanently
 *          logged as an on-chain event with a block timestamp.
 *        - The audit trail can be independently verified by anyone with
 *          access to the chain.
 */
contract HealthRecordContract {

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice Ethereum address that deployed the contract and is the only
    ///         party allowed to call state-changing functions.
    address public immutable owner;

    /// @dev patientId (MongoDB ObjectId string) → ordered list of SHA-256 hashes.
    mapping(string => string[]) private _recordHashes;

    /// @dev patientId → provider address → access currently active?
    mapping(string => mapping(address => bool)) private _accessList;

    /// @dev patientId → provider address → ever added to the providers array?
    ///      Used to prevent duplicate entries in _providers when a provider is
    ///      revoked and then re-granted.
    mapping(string => mapping(address => bool)) private _everListed;

    /// @dev patientId → unique provider addresses (in grant order, never shrinks).
    ///      Use hasAccess() to check whether a listed provider is currently active.
    mapping(string => address[]) private _providers;

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a health record hash is registered on-chain.
     * @param patientId  MongoDB ObjectId of the record owner.
     * @param recordHash SHA-256 hex digest (64 lowercase hex characters).
     * @param timestamp  Unix timestamp of the block that included this tx.
     */
    event RecordAdded(
        string indexed patientId,
        string recordHash,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a provider is newly granted access to a patient's
     *         records.  Not emitted on duplicate grant calls.
     * @param patientId MongoDB ObjectId of the patient.
     * @param provider  Ethereum address of the healthcare provider wallet.
     * @param timestamp Unix timestamp of the block that included this tx.
     */
    event AccessGranted(
        string indexed patientId,
        address indexed provider,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a provider's access is revoked.
     *         Not emitted if the provider did not have active access.
     * @param patientId MongoDB ObjectId of the patient.
     * @param provider  Ethereum address of the healthcare provider wallet.
     * @param timestamp Unix timestamp of the block that included this tx.
     */
    event AccessRevoked(
        string indexed patientId,
        address indexed provider,
        uint256 timestamp
    );

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the contract owner");
        _;
    }

    modifier nonEmptyPatientId(string calldata patientId) {
        require(bytes(patientId).length > 0, "Patient ID must not be empty");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── State-changing functions ─────────────────────────────────────────────

    /**
     * @notice Register the SHA-256 hash of a health record file on-chain.
     *         The hash proves file integrity at the time of upload without
     *         exposing any medical content to the blockchain.
     *
     * @param patientId  MongoDB ObjectId of the patient who owns the record.
     * @param recordHash Lowercase hex-encoded SHA-256 digest — exactly 64 chars.
     *
     * @dev Reverts if:
     *   - caller is not the contract owner
     *   - patientId is empty
     *   - recordHash is not exactly 64 characters
     */
    function addRecord(
        string calldata patientId,
        string calldata recordHash
    )
        external
        onlyOwner
        nonEmptyPatientId(patientId)
    {
        require(
            bytes(recordHash).length == 64,
            "Hash must be a 64-character SHA-256 hex string"
        );
        _recordHashes[patientId].push(recordHash);
        emit RecordAdded(patientId, recordHash, block.timestamp);
    }

    /**
     * @notice Authorise a healthcare provider to access a patient's records.
     *         If the provider already has active access the call succeeds
     *         silently (idempotent) without emitting a duplicate event.
     *
     * @param patientId MongoDB ObjectId of the patient granting access.
     * @param provider  Ethereum address of the healthcare provider wallet.
     *
     * @dev Reverts if caller is not owner, patientId is empty, or provider is
     *      the zero address.
     */
    function grantAccess(
        string calldata patientId,
        address provider
    )
        external
        onlyOwner
        nonEmptyPatientId(patientId)
    {
        require(provider != address(0), "Provider address must not be zero");

        if (!_accessList[patientId][provider]) {
            _accessList[patientId][provider] = true;
            emit AccessGranted(patientId, provider, block.timestamp);

            // Track the unique address for enumeration — add only once.
            if (!_everListed[patientId][provider]) {
                _everListed[patientId][provider] = true;
                _providers[patientId].push(provider);
            }
        }
    }

    /**
     * @notice Revoke a provider's access to a patient's records.
     *         If the provider does not currently have active access the call
     *         succeeds silently (idempotent) without emitting a duplicate event.
     *
     * @param patientId MongoDB ObjectId of the patient revoking access.
     * @param provider  Ethereum address of the healthcare provider wallet.
     *
     * @dev Reverts if caller is not owner, patientId is empty, or provider is
     *      the zero address.
     */
    function revokeAccess(
        string calldata patientId,
        address provider
    )
        external
        onlyOwner
        nonEmptyPatientId(patientId)
    {
        require(provider != address(0), "Provider address must not be zero");

        if (_accessList[patientId][provider]) {
            _accessList[patientId][provider] = false;
            emit AccessRevoked(patientId, provider, block.timestamp);
        }
    }

    // ── View functions ───────────────────────────────────────────────────────

    /**
     * @return All record hashes registered for the patient, in insertion order.
     *         Returns an empty array if no records have been registered.
     */
    function getRecordHashes(
        string calldata patientId
    )
        external
        view
        nonEmptyPatientId(patientId)
        returns (string[] memory)
    {
        return _recordHashes[patientId];
    }

    /**
     * @return Total number of record hashes registered for the patient.
     */
    function getRecordCount(
        string calldata patientId
    )
        external
        view
        nonEmptyPatientId(patientId)
        returns (uint256)
    {
        return _recordHashes[patientId].length;
    }

    /**
     * @return True if the provider currently has active access to the
     *         patient's records (i.e. access has been granted and not revoked).
     */
    function hasAccess(
        string calldata patientId,
        address provider
    )
        external
        view
        nonEmptyPatientId(patientId)
        returns (bool)
    {
        return _accessList[patientId][provider];
    }

    /**
     * @return All unique provider addresses that have ever been granted access
     *         for the patient, in the order they were first added.
     *         Providers that were subsequently revoked remain in this list.
     *         Use hasAccess() to determine current status for each entry.
     */
    function getProviders(
        string calldata patientId
    )
        external
        view
        nonEmptyPatientId(patientId)
        returns (address[] memory)
    {
        return _providers[patientId];
    }
}