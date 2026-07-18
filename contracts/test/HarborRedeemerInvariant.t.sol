// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {HarborRedeemer} from "../src/HarborRedeemer.sol";
import {HarborRedeemerTestBase, Vm} from "./helpers/HarborRedeemerTestBase.sol";
import {MockAssetManager} from "./mocks/MockAssetManager.sol";
import {MockFAsset} from "./mocks/MockFAsset.sol";
import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import {
    IXRPPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistence.sol";

contract HarborRedeemerInvariantTest is HarborRedeemerTestBase {
    HarborRedeemerInvariantHandler private handler;
    address[] private targetedContracts;

    function setUp() public {
        deployHarborFixture(LOT_SIZE_UBA, ASSET_DECIMALS, DEFAULT_KEEPER);
        handler = new HarborRedeemerInvariantHandler(harbor, assetManager, fAsset);
        targetedContracts.push(address(handler));
    }

    function targetContracts() public view returns (address[] memory) {
        return targetedContracts;
    }

    function invariant_AdminCannotTakeUserRecoveryValue() public view {
        assertEq(assetManager.defaultValuePaidTo(handler.owner()), 0, "owner received user value");
        assertEq(assetManager.defaultValuePaidTo(handler.keeper()), 0, "keeper received user value");
        assertEq(fAsset.balanceOf(address(harbor)), 0, "harbor retained fasset");
        assertEq(address(harbor).balance, 0, "harbor retained native");
    }

    function invariant_DefaultExecutionRemainsPermissionless() public view {
        assertEq(handler.permissionlessFailures(), 0, "permissionless default failure");
    }

    /// @dev After any XRP-tag default, Harbor still holds zero FXRP and zero
    /// native (every fee was forwarded to the caller). This is the tag-lane
    /// mirror of the non-custody property covered by
    /// `invariant_AdminCannotTakeUserRecoveryValue`.
    function invariant_XrpDefaultLeavesNoRetainedBalances() public view {
        assertEq(fAsset.balanceOf(address(harbor)), 0, "harbor retained fasset after xrp default");
        assertEq(address(harbor).balance, 0, "harbor retained native after xrp default");
    }
}

contract HarborRedeemerInvariantHandler {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    HarborRedeemer public immutable harbor;
    MockAssetManager public immutable assetManager;
    MockFAsset public immutable fAsset;

    address public constant owner = address(0xA11CE);
    address public constant keeper = address(0xD00D);
    address public constant redeemer = address(0xB0B);
    address private constant agentOwner = address(0xA6E17);
    address private constant caller = address(0xC0FFEE);

    uint256 public permissionlessFailures;

    constructor(HarborRedeemer harbor_, MockAssetManager assetManager_, MockFAsset fAsset_) {
        harbor = harbor_;
        assetManager = assetManager_;
        fAsset = fAsset_;
    }

    function executeExistingRequest(uint256 callerSeed, uint96 redemptionDefaultValueSeed, uint96 executorFeeSeed)
        external
    {
        address selectedCaller = _actor(callerSeed);
        uint256 redemptionDefaultValueNatWei = uint256(redemptionDefaultValueSeed);
        uint256 executorFeeNatWei = uint256(executorFeeSeed);
        uint256 redemptionRequestId = assetManager.createRedemptionRequest(
            redeemer, payable(address(harbor)), agentOwner, redemptionDefaultValueNatWei, executorFeeNatWei
        );

        vm.deal(address(assetManager), address(assetManager).balance + redemptionDefaultValueNatWei + executorFeeNatWei);

        vm.prank(selectedCaller);
        try harbor.executeDefault(_buildProof(uint64(callerSeed), false), redemptionRequestId) {}
        catch {
            permissionlessFailures++;
        }
    }

    /// @dev Tag-default lane: fuzzes random callers, destination tags (including
    /// 0 and 2**32-1), and fee/value seeds against `executeXrpDefault`.
    function executeExistingXrpRequest(
        uint256 callerSeed,
        uint96 redemptionDefaultValueSeed,
        uint96 executorFeeSeed,
        uint32 destinationTag
    ) external {
        address selectedCaller = _actor(callerSeed);
        uint256 redemptionDefaultValueNatWei = uint256(redemptionDefaultValueSeed);
        uint256 executorFeeNatWei = uint256(executorFeeSeed);
        uint256 redemptionRequestId = assetManager.createRedemptionRequest(
            redeemer, payable(address(harbor)), agentOwner, redemptionDefaultValueNatWei, executorFeeNatWei
        );

        vm.deal(address(assetManager), address(assetManager).balance + redemptionDefaultValueNatWei + executorFeeNatWei);

        vm.prank(selectedCaller);
        try harbor.executeXrpDefault(_buildXrpProof(uint64(callerSeed), uint256(destinationTag), true), redemptionRequestId) {}
        catch {
            permissionlessFailures++;
        }
    }

    function updateKeeper(uint256 executorSeed) external {
        address executor = address(uint160(uint256(keccak256(abi.encode(executorSeed, "keeper")))));
        if (executor == address(0)) executor = address(1);

        vm.prank(owner);
        harbor.setDefaultKeeperExecutor(executor);
    }

    function pauseNewRedemptions(bool paused) external {
        assetManager.setNewRedemptionsPaused(paused);
    }

    function _actor(uint256 seed) private pure returns (address) {
        uint256 index = seed % 4;
        if (index == 0) return owner;
        if (index == 1) return keeper;
        if (index == 2) return redeemer;
        return caller;
    }

    function _buildProof(uint64 votingRound, bool checkSourceAddresses)
        private
        pure
        returns (IReferencedPaymentNonexistence.Proof memory proof)
    {
        proof.merkleProof = new bytes32[](1);
        proof.merkleProof[0] = bytes32(uint256(1));
        proof.data.votingRound = votingRound;
        proof.data.requestBody.minimalBlockNumber = 10;
        proof.data.requestBody.deadlineBlockNumber = 20;
        proof.data.requestBody.deadlineTimestamp = 30;
        proof.data.requestBody.amount = 40;
        proof.data.requestBody.standardPaymentReference = bytes32(uint256(50));
        proof.data.requestBody.checkSourceAddresses = checkSourceAddresses;
        proof.data.responseBody.firstOverflowBlockNumber = 21;
        proof.data.responseBody.firstOverflowBlockTimestamp = 31;
    }

    function _buildXrpProof(uint64 votingRound, uint256 destinationTag, bool checkDestinationTag)
        private
        pure
        returns (IXRPPaymentNonexistence.Proof memory proof)
    {
        proof.merkleProof = new bytes32[](1);
        proof.merkleProof[0] = bytes32(uint256(1));
        proof.data.votingRound = votingRound;
        proof.data.requestBody.minimalBlockNumber = 10;
        proof.data.requestBody.deadlineBlockNumber = 20;
        proof.data.requestBody.deadlineTimestamp = 30;
        proof.data.requestBody.amount = 40;
        proof.data.requestBody.checkFirstMemoData = true;
        proof.data.requestBody.firstMemoDataHash = bytes32(uint256(50));
        proof.data.requestBody.checkDestinationTag = checkDestinationTag;
        proof.data.requestBody.destinationTag = destinationTag;
        proof.data.responseBody.firstOverflowBlockNumber = 21;
        proof.data.responseBody.firstOverflowBlockTimestamp = 31;
    }
}
