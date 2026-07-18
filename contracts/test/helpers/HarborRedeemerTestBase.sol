// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HarborRedeemer} from "../../src/HarborRedeemer.sol";
import {MockAssetManager} from "../mocks/MockAssetManager.sol";
import {MockFAsset} from "../mocks/MockFAsset.sol";
import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import {
    IXRPPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistence.sol";

interface Vm {
    function assume(bool condition) external;
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

abstract contract HarborRedeemerTestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant REDEEMER = address(0xB0B);
    address internal constant CALLER = address(0xC0FFEE);
    address internal constant DEFAULT_KEEPER = address(0xD00D);
    address internal constant AGENT_OWNER = address(0xA6E17);

    uint256 internal constant LOT_SIZE_UBA = 10_000_000;
    uint8 internal constant ASSET_DECIMALS = 6;

    MockFAsset internal fAsset;
    MockAssetManager internal assetManager;
    HarborRedeemer internal harbor;

    error AssertionFailed(string message);

    function deployHarborFixture(uint256 lotSizeUBA, uint8 assetDecimals, address initialDefaultKeeperExecutor)
        internal
    {
        fAsset = new MockFAsset(assetDecimals);
        assetManager = new MockAssetManager(IERC20(address(fAsset)), lotSizeUBA, assetDecimals);
        harbor = new HarborRedeemer(address(assetManager), false, initialDefaultKeeperExecutor, OWNER);
    }

    function openDefaultRequest(address redeemer, uint256 redemptionDefaultValueNatWei, uint256 executorFeeNatWei)
        internal
        returns (uint256 redemptionRequestId)
    {
        redemptionRequestId = assetManager.createRedemptionRequest(
            redeemer, payable(address(harbor)), AGENT_OWNER, redemptionDefaultValueNatWei, executorFeeNatWei
        );
        fundAssetManager(redemptionDefaultValueNatWei + executorFeeNatWei);
    }

    function fundAssetManager(uint256 amount) internal {
        vm.deal(address(assetManager), address(assetManager).balance + amount);
    }

    function buildProof(uint64 votingRound, bool checkSourceAddresses)
        internal
        pure
        returns (IReferencedPaymentNonexistence.Proof memory proof)
    {
        proof.merkleProof = new bytes32[](2);
        proof.merkleProof[0] = bytes32(uint256(1));
        proof.merkleProof[1] = bytes32(uint256(2));
        proof.data.attestationType = bytes32("PaymentNonexistence");
        proof.data.sourceId = bytes32("XRP");
        proof.data.votingRound = votingRound;
        proof.data.lowestUsedTimestamp = 5;
        proof.data.requestBody.minimalBlockNumber = 10;
        proof.data.requestBody.deadlineBlockNumber = 20;
        proof.data.requestBody.deadlineTimestamp = 30;
        proof.data.requestBody.destinationAddressHash = bytes32(uint256(40));
        proof.data.requestBody.amount = 50;
        proof.data.requestBody.standardPaymentReference = bytes32(uint256(60));
        proof.data.requestBody.checkSourceAddresses = checkSourceAddresses;
        proof.data.requestBody.sourceAddressesRoot = bytes32(uint256(70));
        proof.data.responseBody.minimalBlockTimestamp = 11;
        proof.data.responseBody.firstOverflowBlockNumber = 21;
        proof.data.responseBody.firstOverflowBlockTimestamp = 31;
    }

    function proofHash(IReferencedPaymentNonexistence.Proof memory proof) internal pure returns (bytes32) {
        return keccak256(abi.encode(proof));
    }

    function buildXrpProof(uint64 votingRound, uint256 destinationTag, bool checkDestinationTag)
        internal
        pure
        returns (IXRPPaymentNonexistence.Proof memory proof)
    {
        proof.merkleProof = new bytes32[](2);
        proof.merkleProof[0] = bytes32(uint256(1));
        proof.merkleProof[1] = bytes32(uint256(2));
        proof.data.attestationType = bytes32("XRPPaymentNonexist");
        proof.data.sourceId = bytes32("testXRP");
        proof.data.votingRound = votingRound;
        proof.data.lowestUsedTimestamp = 5;
        proof.data.requestBody.minimalBlockNumber = 10;
        proof.data.requestBody.deadlineBlockNumber = 20;
        proof.data.requestBody.deadlineTimestamp = 30;
        proof.data.requestBody.destinationAddressHash = bytes32(uint256(40));
        proof.data.requestBody.amount = 50;
        proof.data.requestBody.checkFirstMemoData = true;
        proof.data.requestBody.firstMemoDataHash = bytes32(uint256(60));
        proof.data.requestBody.checkDestinationTag = checkDestinationTag;
        proof.data.requestBody.destinationTag = destinationTag;
        proof.data.requestBody.proofOwner = address(0);
        proof.data.responseBody.minimalBlockTimestamp = 11;
        proof.data.responseBody.firstOverflowBlockNumber = 21;
        proof.data.responseBody.firstOverflowBlockTimestamp = 31;
    }

    function xrpProofHash(IXRPPaymentNonexistence.Proof memory proof) internal pure returns (bytes32) {
        return keccak256(abi.encode(proof));
    }

    function bound(uint256 seed, uint256 minimum, uint256 maximum) internal pure returns (uint256) {
        if (minimum > maximum) revert AssertionFailed("invalid bound");

        uint256 size = maximum - minimum + 1;
        return minimum + (seed % size);
    }

    function assertTrue(bool actual, string memory message) internal pure {
        if (!actual) revert AssertionFailed(message);
    }

    function assertFalse(bool actual, string memory message) internal pure {
        if (actual) revert AssertionFailed(message);
    }

    function assertEq(address actual, address expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(uint8 actual, uint8 expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(bytes32 actual, bytes32 expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(string memory actual, string memory expected, string memory message) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert AssertionFailed(message);
    }
}
