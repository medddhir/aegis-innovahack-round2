// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ITestToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Aegis Policy Wallet
/// @notice Task-bound two-phase settlement wallet for local-EVM enforcement proof.
/// @dev Uses mock/test tokens only. The agent can request but cannot mutate financial authority.
contract AegisPolicyWallet {
    enum IntentStatus {
        NONE,
        PENDING,
        EXECUTED,
        CANCELLED
    }

    struct PendingIntent {
        address recipient;
        uint256 amount;
        bytes32 taskHash;
        bytes32 nonce;
        uint256 policyVersion;
        uint256 requestedAt;
        uint256 executeAfter;
        uint256 dayBucket;
        IntentStatus status;
    }

    ITestToken public immutable testToken;
    address public owner;
    address public authorisedAgent;
    bytes32 public activeTaskHash;
    uint256 public perTransactionLimit;
    uint256 public totalTaskBudget;
    uint256 public dailyCumulativeLimit;
    uint256 public expiryTimestamp;
    uint256 public settlementDelay;
    uint256 public policyVersion;
    bool public frozen;

    uint256 public totalSpent;
    mapping(uint256 => uint256) public reservedByVersion;
    mapping(uint256 => uint256) public dailySpent;
    mapping(uint256 => mapping(uint256 => uint256)) public dailyReservedByVersion;
    mapping(address => bool) public approvedRecipients;
    mapping(bytes32 => bool) public usedNonces;
    mapping(bytes32 => PendingIntent) private _intents;

    uint256 private _guard = 1;

    event PolicyActivated(
        uint256 indexed policyVersion,
        address indexed owner,
        address indexed authorisedAgent,
        bytes32 taskHash,
        uint256 perTransactionLimit,
        uint256 totalTaskBudget,
        uint256 dailyCumulativeLimit,
        uint256 expiryTimestamp,
        uint256 settlementDelay
    );
    event PolicyUpdated(
        uint256 indexed policyVersion,
        address indexed authorisedAgent,
        bytes32 taskHash,
        uint256 perTransactionLimit,
        uint256 totalTaskBudget,
        uint256 dailyCumulativeLimit,
        uint256 expiryTimestamp,
        uint256 settlementDelay
    );
    event RecipientApproved(address indexed recipient, uint256 indexed policyVersion);
    event RecipientRemoved(address indexed recipient, uint256 indexed policyVersion);
    event IntentRequested(
        bytes32 indexed intentId,
        address indexed agent,
        address indexed recipient,
        uint256 amount,
        bytes32 taskHash,
        bytes32 nonce,
        uint256 policyVersion
    );
    event IntentAuthorised(
        bytes32 indexed intentId,
        address indexed recipient,
        uint256 amount,
        uint256 executeAfter,
        uint256 indexed policyVersion
    );
    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed recipient,
        uint256 amount,
        uint256 indexed policyVersion
    );
    event IntentCancelled(
        bytes32 indexed intentId,
        uint256 amountReleased,
        uint256 indexed intentPolicyVersion,
        uint256 indexed activePolicyVersion
    );
    event WalletFrozen(address indexed owner, uint256 indexed policyVersion);
    event WalletRestored(address indexed owner, uint256 indexed policyVersion);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error ZeroAddress();
    error UnauthorizedOwner(address caller);
    error UnauthorizedAgent(address caller);
    error WalletIsFrozen();
    error WalletNotFrozen();
    error PolicyExpired(uint256 expiryTimestamp);
    error TaskMismatch(bytes32 supplied, bytes32 required);
    error RecipientNotApproved(address recipient);
    error InvalidAmount();
    error PerTransactionLimitExceeded(uint256 requested, uint256 limit);
    error TotalBudgetExceeded(uint256 requestedTotal, uint256 budget);
    error DailyLimitExceeded(uint256 requestedTotal, uint256 limit);
    error NonceAlreadyUsed(bytes32 nonce);
    error InsufficientTestFunds(uint256 available, uint256 required);
    error StalePolicyVersion(uint256 supplied, uint256 current);
    error IntentNotPending(bytes32 intentId);
    error SettlementDelayActive(uint256 executeAfter);
    error TokenTransferFailed();
    error InvalidPolicy();
    error ReentrantCall();

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedOwner(msg.sender);
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != authorisedAgent) revert UnauthorizedAgent(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    constructor(
        address tokenAddress,
        address agentAddress,
        bytes32 taskHash,
        uint256 transactionLimit,
        uint256 taskBudget,
        uint256 dailyLimit,
        uint256 expiresAt,
        uint256 delaySeconds,
        address[] memory initialRecipients
    ) {
        if (tokenAddress == address(0) || agentAddress == address(0)) revert ZeroAddress();
        _validatePolicy(taskHash, transactionLimit, taskBudget, dailyLimit, expiresAt);
        testToken = ITestToken(tokenAddress);
        owner = msg.sender;
        authorisedAgent = agentAddress;
        activeTaskHash = taskHash;
        perTransactionLimit = transactionLimit;
        totalTaskBudget = taskBudget;
        dailyCumulativeLimit = dailyLimit;
        expiryTimestamp = expiresAt;
        settlementDelay = delaySeconds;
        policyVersion = 1;

        uint256 length = initialRecipients.length;
        for (uint256 index; index < length; ++index) {
            address recipient = initialRecipients[index];
            if (recipient == address(0)) revert ZeroAddress();
            approvedRecipients[recipient] = true;
        }

        emit PolicyActivated(
            policyVersion,
            owner,
            authorisedAgent,
            activeTaskHash,
            perTransactionLimit,
            totalTaskBudget,
            dailyCumulativeLimit,
            expiryTimestamp,
            settlementDelay
        );
    }

    function requestIntent(
        address recipient,
        uint256 amount,
        bytes32 taskHash,
        bytes32 nonce,
        uint256 suppliedPolicyVersion
    ) external onlyAgent returns (bytes32 intentId) {
        if (frozen) revert WalletIsFrozen();
        if (suppliedPolicyVersion != policyVersion) {
            revert StalePolicyVersion(suppliedPolicyVersion, policyVersion);
        }
        if (block.timestamp >= expiryTimestamp) revert PolicyExpired(expiryTimestamp);
        if (taskHash != activeTaskHash) revert TaskMismatch(taskHash, activeTaskHash);
        if (!approvedRecipients[recipient]) revert RecipientNotApproved(recipient);
        if (amount == 0) revert InvalidAmount();
        if (amount > perTransactionLimit) {
            revert PerTransactionLimitExceeded(amount, perTransactionLimit);
        }

        uint256 reserved = reservedByVersion[policyVersion];
        uint256 requestedTotal = totalSpent + reserved + amount;
        if (requestedTotal > totalTaskBudget) {
            revert TotalBudgetExceeded(requestedTotal, totalTaskBudget);
        }

        uint256 dayBucket = block.timestamp / 1 days;
        if (dailyCumulativeLimit != 0) {
            uint256 requestedDaily = dailySpent[dayBucket]
                + dailyReservedByVersion[policyVersion][dayBucket]
                + amount;
            if (requestedDaily > dailyCumulativeLimit) {
                revert DailyLimitExceeded(requestedDaily, dailyCumulativeLimit);
            }
        }

        if (usedNonces[nonce]) revert NonceAlreadyUsed(nonce);
        uint256 available = testToken.balanceOf(address(this));
        uint256 required = reserved + amount;
        if (available < required) revert InsufficientTestFunds(available, required);

        intentId = keccak256(
            abi.encode(
                address(this),
                msg.sender,
                recipient,
                amount,
                taskHash,
                nonce,
                suppliedPolicyVersion
            )
        );
        usedNonces[nonce] = true;
        reservedByVersion[policyVersion] = reserved + amount;
        dailyReservedByVersion[policyVersion][dayBucket] += amount;
        _intents[intentId] = PendingIntent({
            recipient: recipient,
            amount: amount,
            taskHash: taskHash,
            nonce: nonce,
            policyVersion: suppliedPolicyVersion,
            requestedAt: block.timestamp,
            executeAfter: block.timestamp + settlementDelay,
            dayBucket: dayBucket,
            status: IntentStatus.PENDING
        });

        emit IntentRequested(
            intentId,
            msg.sender,
            recipient,
            amount,
            taskHash,
            nonce,
            suppliedPolicyVersion
        );
        emit IntentAuthorised(
            intentId,
            recipient,
            amount,
            block.timestamp + settlementDelay,
            suppliedPolicyVersion
        );
    }

    function executeIntent(bytes32 intentId) external nonReentrant {
        PendingIntent storage pending = _intents[intentId];
        if (frozen) revert WalletIsFrozen();
        if (pending.policyVersion != policyVersion) {
            revert StalePolicyVersion(pending.policyVersion, policyVersion);
        }
        if (pending.taskHash != activeTaskHash) {
            revert TaskMismatch(pending.taskHash, activeTaskHash);
        }
        if (!approvedRecipients[pending.recipient]) {
            revert RecipientNotApproved(pending.recipient);
        }
        if (block.timestamp >= expiryTimestamp) revert PolicyExpired(expiryTimestamp);
        if (pending.status != IntentStatus.PENDING) revert IntentNotPending(intentId);
        if (block.timestamp < pending.executeAfter) {
            revert SettlementDelayActive(pending.executeAfter);
        }

        pending.status = IntentStatus.EXECUTED;
        reservedByVersion[pending.policyVersion] -= pending.amount;
        dailyReservedByVersion[pending.policyVersion][pending.dayBucket] -= pending.amount;
        totalSpent += pending.amount;
        dailySpent[pending.dayBucket] += pending.amount;

        if (!testToken.transfer(pending.recipient, pending.amount)) {
            revert TokenTransferFailed();
        }
        emit IntentExecuted(
            intentId,
            pending.recipient,
            pending.amount,
            pending.policyVersion
        );
    }

    function cancelIntent(bytes32 intentId) external onlyOwner {
        PendingIntent storage pending = _intents[intentId];
        if (pending.status != IntentStatus.PENDING) revert IntentNotPending(intentId);
        pending.status = IntentStatus.CANCELLED;
        reservedByVersion[pending.policyVersion] -= pending.amount;
        dailyReservedByVersion[pending.policyVersion][pending.dayBucket] -= pending.amount;
        emit IntentCancelled(
            intentId,
            pending.amount,
            pending.policyVersion,
            policyVersion
        );
    }

    function freeze() external onlyOwner {
        if (frozen) revert WalletIsFrozen();
        frozen = true;
        unchecked {
            ++policyVersion;
        }
        emit WalletFrozen(msg.sender, policyVersion);
    }

    function restore() external onlyOwner {
        if (!frozen) revert WalletNotFrozen();
        frozen = false;
        unchecked {
            ++policyVersion;
        }
        emit WalletRestored(msg.sender, policyVersion);
    }

    function updatePolicy(
        address agentAddress,
        bytes32 taskHash,
        uint256 transactionLimit,
        uint256 taskBudget,
        uint256 dailyLimit,
        uint256 expiresAt,
        uint256 delaySeconds
    ) external onlyOwner {
        if (agentAddress == address(0)) revert ZeroAddress();
        _validatePolicy(taskHash, transactionLimit, taskBudget, dailyLimit, expiresAt);
        if (taskBudget < totalSpent) revert InvalidPolicy();
        authorisedAgent = agentAddress;
        activeTaskHash = taskHash;
        perTransactionLimit = transactionLimit;
        totalTaskBudget = taskBudget;
        dailyCumulativeLimit = dailyLimit;
        expiryTimestamp = expiresAt;
        settlementDelay = delaySeconds;
        unchecked {
            ++policyVersion;
        }
        emit PolicyUpdated(
            policyVersion,
            authorisedAgent,
            activeTaskHash,
            perTransactionLimit,
            totalTaskBudget,
            dailyCumulativeLimit,
            expiryTimestamp,
            settlementDelay
        );
    }

    function approveRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        approvedRecipients[recipient] = true;
        unchecked {
            ++policyVersion;
        }
        emit RecipientApproved(recipient, policyVersion);
    }

    function removeRecipient(address recipient) external onlyOwner {
        approvedRecipients[recipient] = false;
        unchecked {
            ++policyVersion;
        }
        emit RecipientRemoved(recipient, policyVersion);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function getIntent(bytes32 intentId) external view returns (PendingIntent memory) {
        return _intents[intentId];
    }

    function currentReserved() external view returns (uint256) {
        return reservedByVersion[policyVersion];
    }

    function currentDailyReserved() external view returns (uint256) {
        return dailyReservedByVersion[policyVersion][block.timestamp / 1 days];
    }

    function _validatePolicy(
        bytes32 taskHash,
        uint256 transactionLimit,
        uint256 taskBudget,
        uint256 dailyLimit,
        uint256 expiresAt
    ) internal view {
        if (
            taskHash == bytes32(0)
                || transactionLimit == 0
                || taskBudget == 0
                || transactionLimit > taskBudget
                || (dailyLimit != 0 && transactionLimit > dailyLimit)
                || expiresAt <= block.timestamp
        ) revert InvalidPolicy();
    }
}
