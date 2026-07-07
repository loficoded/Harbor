// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import {AssetManagerSettings} from "@flarenetwork/flare-periphery-contracts/coston2/data/AssetManagerSettings.sol";

interface IHarborDefaultExecutor {
    function executeDefault(IReferencedPaymentNonexistence.Proof calldata proof, uint256 redemptionRequestId) external;
}

contract MockAssetManager {
    struct RedemptionRequest {
        address redeemer;
        address payable executor;
        address agentOwner;
        uint256 redemptionDefaultValueNatWei;
        uint256 executorFeeNatWei;
        bool exists;
        bool defaulted;
    }

    IERC20 public immutable fAsset;

    uint256 private immutable lotSizeValue;
    AssetManagerSettings.Data private settings;

    mapping(uint256 redemptionRequestId => RedemptionRequest request) private redemptionRequests;
    mapping(address account => uint256 amount) public defaultValuePaidTo;
    mapping(address account => uint256 amount) public executorFeePaidTo;

    uint256 public nextRedemptionRequestId = 1;
    uint256 public lastCreatedRedemptionRequestId;
    uint256 public lastRedeemLots;
    uint256 public lastRedeemedAmountUBA;
    string public lastRedeemerUnderlyingAddress;
    address public lastRedeemCaller;
    address public lastRedeemExecutor;

    address public lastDefaultCaller;
    uint256 public lastRedemptionRequestId;
    bytes32 public lastProofHash;
    uint64 public lastVotingRound;
    bool public lastCheckSourceAddresses;
    uint256 public defaultCallCount;
    bool public reentrantCallSucceeded;
    bool public reentrantCallReverted;

    bool public newRedemptionsPaused;
    bool private attemptReentrancy;

    constructor(IERC20 fAsset_, uint256 lotSizeUBA_, uint8 assetDecimals_) {
        fAsset = fAsset_;
        lotSizeValue = lotSizeUBA_;
        settings.assetDecimals = assetDecimals_;
        settings.fAsset = address(fAsset_);
    }

    receive() external payable {}

    function setNewRedemptionsPaused(bool paused) external {
        newRedemptionsPaused = paused;
    }

    function setAttemptReentrancy(bool attemptReentrancy_) external {
        attemptReentrancy = attemptReentrancy_;
        reentrantCallSucceeded = false;
        reentrantCallReverted = false;
    }

    function lotSize() external view returns (uint256) {
        return lotSizeValue;
    }

    function getSettings() external view returns (AssetManagerSettings.Data memory) {
        return settings;
    }

    function requestExecutor(uint256 redemptionRequestId) external view returns (address) {
        return redemptionRequests[redemptionRequestId].executor;
    }

    function requestRedeemer(uint256 redemptionRequestId) external view returns (address) {
        return redemptionRequests[redemptionRequestId].redeemer;
    }

    function requestDefaulted(uint256 redemptionRequestId) external view returns (bool) {
        return redemptionRequests[redemptionRequestId].defaulted;
    }

    function createRedemptionRequest(
        address redeemer,
        address payable executor,
        address agentOwner,
        uint256 redemptionDefaultValueNatWei,
        uint256 executorFeeNatWei
    ) external returns (uint256 redemptionRequestId) {
        redemptionRequestId = nextRedemptionRequestId++;
        _storeRedemptionRequest(
            redemptionRequestId, redeemer, executor, agentOwner, redemptionDefaultValueNatWei, executorFeeNatWei
        );
    }

    function createRedemptionRequestWithId(
        uint256 redemptionRequestId,
        address redeemer,
        address payable executor,
        address agentOwner,
        uint256 redemptionDefaultValueNatWei,
        uint256 executorFeeNatWei
    ) external {
        require(!redemptionRequests[redemptionRequestId].exists, "request already exists");
        if (redemptionRequestId >= nextRedemptionRequestId) {
            nextRedemptionRequestId = redemptionRequestId + 1;
        }
        _storeRedemptionRequest(
            redemptionRequestId, redeemer, executor, agentOwner, redemptionDefaultValueNatWei, executorFeeNatWei
        );
    }

    function setRedemptionDefaultPayouts(
        uint256 redemptionRequestId,
        uint256 redemptionDefaultValueNatWei,
        uint256 executorFeeNatWei
    ) external {
        RedemptionRequest storage request = redemptionRequests[redemptionRequestId];
        require(request.exists, "unknown redemption request");
        require(!request.defaulted, "request already defaulted");

        request.redemptionDefaultValueNatWei = redemptionDefaultValueNatWei;
        request.executorFeeNatWei = executorFeeNatWei;
    }

    function redeem(uint256 lots, string memory redeemerUnderlyingAddress, address payable executor)
        external
        payable
        returns (uint256 redeemedAmountUBA)
    {
        require(!newRedemptionsPaused, "new redemptions paused");

        redeemedAmountUBA = lots * lotSizeValue;
        if (redeemedAmountUBA != 0) {
            require(fAsset.transferFrom(msg.sender, address(this), redeemedAmountUBA), "fasset transfer failed");
        }

        lastRedeemLots = lots;
        lastRedeemedAmountUBA = redeemedAmountUBA;
        lastRedeemerUnderlyingAddress = redeemerUnderlyingAddress;
        lastRedeemCaller = msg.sender;
        lastRedeemExecutor = executor;

        uint256 redemptionRequestId = nextRedemptionRequestId++;
        _storeRedemptionRequest(redemptionRequestId, msg.sender, executor, address(0), 0, msg.value);
    }

    function redemptionPaymentDefault(IReferencedPaymentNonexistence.Proof calldata proof, uint256 redemptionRequestId)
        external
    {
        RedemptionRequest storage request = redemptionRequests[redemptionRequestId];
        require(request.exists, "unknown redemption request");
        require(!request.defaulted, "request already defaulted");
        require(
            msg.sender == request.redeemer || msg.sender == request.executor || msg.sender == request.agentOwner,
            "default caller not authorized"
        );

        defaultCallCount++;
        lastDefaultCaller = msg.sender;
        lastRedemptionRequestId = redemptionRequestId;
        lastProofHash = keccak256(abi.encode(proof));
        lastVotingRound = proof.data.votingRound;
        lastCheckSourceAddresses = proof.data.requestBody.checkSourceAddresses;

        if (attemptReentrancy) {
            attemptReentrancy = false;
            try IHarborDefaultExecutor(msg.sender).executeDefault(proof, redemptionRequestId + 1) {
                reentrantCallSucceeded = true;
            } catch {
                reentrantCallReverted = true;
            }
        }

        request.defaulted = true;

        uint256 redemptionDefaultValueNatWei = request.redemptionDefaultValueNatWei;
        request.redemptionDefaultValueNatWei = 0;
        if (redemptionDefaultValueNatWei != 0) {
            defaultValuePaidTo[request.redeemer] += redemptionDefaultValueNatWei;
            _sendNative(payable(request.redeemer), redemptionDefaultValueNatWei);
        }

        uint256 executorFeeNatWei = request.executorFeeNatWei;
        request.executorFeeNatWei = 0;
        if (executorFeeNatWei != 0) {
            executorFeePaidTo[msg.sender] += executorFeeNatWei;
            _sendNative(payable(msg.sender), executorFeeNatWei);
        }
    }

    function sendNativeTo(address payable recipient, uint256 amount) external {
        _sendNative(recipient, amount);
    }

    function _storeRedemptionRequest(
        uint256 redemptionRequestId,
        address redeemer,
        address payable executor,
        address agentOwner,
        uint256 redemptionDefaultValueNatWei,
        uint256 executorFeeNatWei
    ) private {
        require(redeemer != address(0), "redeemer is zero");
        require(executor != address(0), "executor is zero");
        require(!redemptionRequests[redemptionRequestId].exists, "request already exists");

        redemptionRequests[redemptionRequestId] = RedemptionRequest({
            redeemer: redeemer,
            executor: executor,
            agentOwner: agentOwner,
            redemptionDefaultValueNatWei: redemptionDefaultValueNatWei,
            executorFeeNatWei: executorFeeNatWei,
            exists: true,
            defaulted: false
        });
        lastCreatedRedemptionRequestId = redemptionRequestId;
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        require(success, "native transfer failed");
    }
}
