// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {HarborRedeemer} from "../src/HarborRedeemer.sol";
import {HarborRedeemerTestBase} from "./helpers/HarborRedeemerTestBase.sol";
import {MockAssetManager} from "./mocks/MockAssetManager.sol";
import {MockFAsset} from "./mocks/MockFAsset.sol";
import {MockRegistry} from "./mocks/MockRegistry.sol";
import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";

contract HarborRedeemerTest is HarborRedeemerTestBase {
    event RedemptionDefaultForwarded(
        address indexed caller, uint256 indexed redemptionRequestId, uint256 forwardedExecutorFeeNatWei
    );
    event DefaultKeeperExecutorUpdated(address indexed executor);

    function setUp() public {
        deployHarborFixture(LOT_SIZE_UBA, ASSET_DECIMALS, DEFAULT_KEEPER);
    }

    function testConstructorExposesConfiguredProtocolHelpers() public view {
        assertEq(harbor.FXRP_ASSET_MANAGER_REGISTRY_NAME(), "AssetManagerFXRP", "asset manager registry name");
        assertEq(harbor.owner(), OWNER, "owner");
        assertEq(harbor.assetManagerAddress(), address(assetManager), "asset manager");
        assertEq(harbor.fAssetTokenAddress(), address(fAsset), "fasset");
        assertEq(harbor.lotSizeUBA(), LOT_SIZE_UBA, "lot size");
        assertEq(uint256(harbor.assetDecimals()), uint256(ASSET_DECIMALS), "asset decimals");
        assertEq(harbor.defaultKeeperExecutor(), DEFAULT_KEEPER, "default keeper");
    }

    function testConstructorResolvesAssetManagerFromRegistryAndDefaultsKeeperToSelf() public {
        MockRegistry registry = new MockRegistry(address(assetManager));
        HarborRedeemer resolvedHarbor = new HarborRedeemer(address(registry), true, address(0), OWNER);

        assertEq(resolvedHarbor.assetManagerAddress(), address(assetManager), "resolved asset manager");
        assertEq(resolvedHarbor.fAssetTokenAddress(), address(fAsset), "resolved fasset");
        assertEq(resolvedHarbor.defaultKeeperExecutor(), address(resolvedHarbor), "zero default becomes harbor");
    }

    function testConstructorRejectsZeroAssetManagerAddress() public {
        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.ZeroAddress.selector));
        new HarborRedeemer(address(0), false, DEFAULT_KEEPER, OWNER);
    }

    function testConstructorRejectsRegistryThatDoesNotResolveAssetManager() public {
        MockRegistry registry = new MockRegistry(address(0));

        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.AssetManagerResolutionFailed.selector));
        new HarborRedeemer(address(registry), true, DEFAULT_KEEPER, OWNER);
    }

    function testConstructorRejectsAssetManagerWithoutFAsset() public {
        MockAssetManager assetManagerWithoutToken =
            new MockAssetManager(MockFAsset(address(0)), LOT_SIZE_UBA, ASSET_DECIMALS);

        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.AssetManagerResolutionFailed.selector));
        new HarborRedeemer(address(assetManagerWithoutToken), false, DEFAULT_KEEPER, OWNER);
    }

    function testConstructorRejectsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new HarborRedeemer(address(assetManager), false, DEFAULT_KEEPER, address(0));
    }

    function testReceiveAcceptsNativeOnlyFromAssetManager() public {
        fundAssetManager(1 wei);

        assetManager.sendNativeTo(payable(address(harbor)), 1 wei);

        assertEq(address(harbor).balance, 1 wei, "asset manager native accepted");
    }

    function testDirectNativeTransfersAreRejected() public {
        vm.deal(address(this), 1 ether);

        (bool success,) = address(harbor).call{value: 1 wei}("");

        assertFalse(success, "direct native transfer rejected");
        assertEq(address(harbor).balance, 0, "harbor retained native");
    }

    function testOwnerCanUpdateDefaultKeeperExecutor() public {
        address newKeeper = address(0xFEED);

        vm.expectEmit(true, false, false, true, address(harbor));
        emit DefaultKeeperExecutorUpdated(newKeeper);

        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(newKeeper);

        assertEq(harbor.defaultKeeperExecutor(), newKeeper, "updated keeper");
    }

    function testNonOwnerCannotUpdateDefaultKeeperExecutor() public {
        address nonOwner = address(0xBAD);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner));
        vm.prank(nonOwner);
        harbor.setDefaultKeeperExecutor(address(0xFEED));
    }

    function testDefaultKeeperExecutorCannotBeZero() public {
        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.ZeroAddress.selector));
        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(address(0));
    }

    function testOwnerCanTransferOwnershipAndNewOwnerControlsKeeper() public {
        address newOwner = address(0x5150);
        address newKeeper = address(0xFEED);

        vm.prank(OWNER);
        harbor.transferOwnership(newOwner);

        assertEq(harbor.owner(), newOwner, "new owner");

        vm.prank(newOwner);
        harbor.setDefaultKeeperExecutor(newKeeper);

        assertEq(harbor.defaultKeeperExecutor(), newKeeper, "new owner updated keeper");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OWNER));
        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(address(0xBEEF));
    }

    function testTransferOwnershipRejectsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        vm.prank(OWNER);
        harbor.transferOwnership(address(0));
    }

    function testRenounceOwnershipDisablesAdminKeeperUpdates() public {
        vm.prank(OWNER);
        harbor.renounceOwnership();

        assertEq(harbor.owner(), address(0), "renounced owner");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OWNER));
        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(address(0xFEED));
    }

    function testNonOwnerCannotRenounceOwnership() public {
        address nonOwner = address(0xBAD);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner));
        vm.prank(nonOwner);
        harbor.renounceOwnership();
    }

    function testExecuteDefaultIsPermissionlessAndForwardsEntireProof() public {
        IReferencedPaymentNonexistence.Proof memory proof = buildProof(42, true);
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, 0);

        vm.prank(CALLER);
        harbor.executeDefault(proof, requestId);

        assertEq(assetManager.lastDefaultCaller(), address(harbor), "asset manager caller");
        assertEq(assetManager.lastRedemptionRequestId(), requestId, "request id");
        assertEq(assetManager.lastVotingRound(), 42, "voting round");
        assertTrue(assetManager.lastCheckSourceAddresses(), "proof flag forwarded");
        assertEq(assetManager.lastProofHash(), proofHash(proof), "proof hash");
    }

    function testExecuteDefaultDoesNotRequireOwnerKeeperOrRedeemerCaller() public {
        assertCallerCanExecuteDefault(OWNER);
        assertCallerCanExecuteDefault(DEFAULT_KEEPER);
        assertCallerCanExecuteDefault(REDEEMER);
        assertCallerCanExecuteDefault(CALLER);
    }

    function testExecuteDefaultForwardsExecutorFeeToCaller() public {
        IReferencedPaymentNonexistence.Proof memory proof = buildProof(7, false);
        uint256 executorFee = 1.25 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);
        uint256 callerBalanceBefore = CALLER.balance;

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, executorFee);

        vm.prank(CALLER);
        harbor.executeDefault(proof, requestId);

        assertEq(CALLER.balance, callerBalanceBefore + executorFee, "caller fee");
        assertEq(address(harbor).balance, 0, "harbor retained native");
        assertEq(address(assetManager).balance, 0, "asset manager spent fee");
    }

    function testExecuteDefaultPaysUserRecoveryValueDirectlyToRedeemer() public {
        uint256 redemptionDefaultValue = 5 ether;
        uint256 executorFee = 0.2 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionDefaultValue, executorFee);
        uint256 redeemerBalanceBefore = REDEEMER.balance;
        uint256 callerBalanceBefore = CALLER.balance;

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(8, false), requestId);

        assertEq(REDEEMER.balance, redeemerBalanceBefore + redemptionDefaultValue, "redeemer default value");
        assertEq(CALLER.balance, callerBalanceBefore + executorFee, "caller executor fee");
        assertEq(assetManager.defaultValuePaidTo(REDEEMER), redemptionDefaultValue, "tracked user value");
        assertEq(assetManager.executorFeePaidTo(address(harbor)), executorFee, "tracked executor fee");
        assertEq(address(harbor).balance, 0, "harbor retained native");
    }

    function testAdminCannotWithdrawOrRedirectUserRedemptionValue() public {
        uint256 redemptionDefaultValue = 3 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionDefaultValue, 0);
        uint256 ownerBalanceBefore = OWNER.balance;
        uint256 redeemerBalanceBefore = REDEEMER.balance;

        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(OWNER);

        vm.prank(OWNER);
        harbor.executeDefault(buildProof(9, false), requestId);

        assertEq(REDEEMER.balance, redeemerBalanceBefore + redemptionDefaultValue, "redeemer kept recovery");
        assertEq(OWNER.balance, ownerBalanceBefore, "owner did not receive user value");
        assertEq(assetManager.defaultValuePaidTo(OWNER), 0, "owner tracked user value");
        assertEq(address(harbor).balance, 0, "harbor retained native");
    }

    function testNewRedemptionPauseDoesNotBlockDefaultExecution() public {
        uint256 redemptionDefaultValue = 2 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionDefaultValue, 0);

        assetManager.setNewRedemptionsPaused(true);

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(10, false), requestId);

        assertEq(assetManager.defaultValuePaidTo(REDEEMER), redemptionDefaultValue, "paused default paid");
        assertTrue(assetManager.requestDefaulted(requestId), "request defaulted");
    }

    function testKeeperUpdateDoesNotChangeExistingRequestRecovery() public {
        uint256 redemptionDefaultValue = 4 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionDefaultValue, 0);
        address newKeeper = address(0xFEED);

        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(newKeeper);

        assertEq(harbor.defaultKeeperExecutor(), newKeeper, "helper output updated");
        assertEq(assetManager.requestExecutor(requestId), address(harbor), "existing executor unchanged");

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(11, false), requestId);

        assertEq(assetManager.defaultValuePaidTo(REDEEMER), redemptionDefaultValue, "existing request recovered");
    }

    function testNormalRedemptionDefaultLeavesNoHarborTokenOrNativeBalance() public {
        uint256 lots = 3;
        uint256 redeemedAmountUBA = lots * LOT_SIZE_UBA;
        uint256 redemptionDefaultValue = 6 ether;
        uint256 executorFee = 0.4 ether;

        fAsset.mint(REDEEMER, redeemedAmountUBA);

        vm.startPrank(REDEEMER);
        fAsset.approve(address(assetManager), redeemedAmountUBA);
        uint256 actualRedeemedAmountUBA =
            assetManager.redeem(lots, "rHarborRedeemerDestination", payable(address(harbor)));
        vm.stopPrank();

        uint256 requestId = assetManager.lastCreatedRedemptionRequestId();
        assetManager.setRedemptionDefaultPayouts(requestId, redemptionDefaultValue, executorFee);
        fundAssetManager(redemptionDefaultValue + executorFee);

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(12, false), requestId);

        assertEq(actualRedeemedAmountUBA, redeemedAmountUBA, "redeemed amount");
        assertEq(fAsset.balanceOf(address(harbor)), 0, "harbor retained fasset");
        assertEq(address(harbor).balance, 0, "harbor retained native");
        assertEq(address(assetManager).balance, 0, "asset manager paid normal default");
    }

    function testExecuteDefaultRejectsReentrancyFromAssetManager() public {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        assetManager.setAttemptReentrancy(true);

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(13, false), requestId);

        assertFalse(assetManager.reentrantCallSucceeded(), "reentrant call succeeded");
        assertTrue(assetManager.reentrantCallReverted(), "reentrant call reverted");
        assertEq(assetManager.defaultCallCount(), 1, "only outer default call completed");
    }

    function testExecuteDefaultRevertsWhenExecutorFeeForwardFails() public {
        RejectingNativeReceiver rejectingCaller = new RejectingNativeReceiver();
        uint256 executorFee = 1 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);

        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.NativeForwardFailed.selector));
        rejectingCaller.executeDefault(harbor, buildProof(14, false), requestId);

        assertFalse(assetManager.requestDefaulted(requestId), "request not defaulted");
        assertEq(address(harbor).balance, 0, "harbor retained native");
        assertEq(address(assetManager).balance, executorFee, "asset manager balance restored");
    }

    function testMockFAssetConfigurableTransferBehavior() public {
        fAsset.mint(REDEEMER, 100);

        vm.prank(REDEEMER);
        assertTrue(fAsset.transfer(CALLER, 10), "transfer succeeds");
        assertEq(fAsset.balanceOf(CALLER), 10, "caller balance");

        fAsset.setTransferBehavior(MockFAsset.TransferBehavior.ReturnsFalse);

        vm.prank(REDEEMER);
        assertFalse(fAsset.transfer(CALLER, 10), "transfer returns false");
        assertEq(fAsset.balanceOf(CALLER), 10, "false transfer did not mutate");

        fAsset.setTransferBehavior(MockFAsset.TransferBehavior.Reverts);

        vm.expectRevert(abi.encodeWithSelector(MockFAsset.ConfiguredTransferRevert.selector));
        vm.prank(REDEEMER);
        fAsset.transfer(CALLER, 10);
    }

    function testFuzzLotSizeAndAssetDecimalsHelpers(uint96 lotSizeUBA, uint8 assetDecimals) public {
        deployHarborFixture(uint256(lotSizeUBA), assetDecimals, DEFAULT_KEEPER);

        assertEq(harbor.lotSizeUBA(), uint256(lotSizeUBA), "fuzz lot size");
        assertEq(uint256(harbor.assetDecimals()), uint256(assetDecimals), "fuzz asset decimals");
    }

    function testFuzzExecuteDefaultAnyCallerAndNativeExecutorFee(
        address caller,
        uint96 fee,
        uint64 votingRound,
        bool checkSourceAddresses
    ) public {
        vm.assume(caller != address(0));
        vm.assume(uint160(caller) > 0xffff);
        vm.assume(caller.code.length == 0);

        uint256 executorFee = uint256(fee);
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);
        uint256 callerBalanceBefore = caller.balance;

        vm.prank(caller);
        harbor.executeDefault(buildProof(votingRound, checkSourceAddresses), requestId);

        assertEq(assetManager.lastDefaultCaller(), address(harbor), "asset manager caller");
        assertEq(assetManager.lastRedemptionRequestId(), requestId, "fuzz request id");
        assertEq(assetManager.lastVotingRound(), votingRound, "fuzz voting round");
        assertEq(caller.balance, callerBalanceBefore + executorFee, "fuzz caller fee");
        assertEq(address(harbor).balance, 0, "fuzz harbor retained native");
    }

    function testFuzzOwnerCanSetAnyNonzeroKeeper(address executor) public {
        vm.assume(executor != address(0));

        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(executor);

        assertEq(harbor.defaultKeeperExecutor(), executor, "fuzz keeper");
    }

    function testFuzzKeeperUpdateDoesNotBlockExistingRecovery(address executor, address caller, uint96 value) public {
        vm.assume(executor != address(0));
        vm.assume(caller != address(0));
        vm.assume(uint160(caller) > 0xffff);
        vm.assume(caller.code.length == 0);

        uint256 redemptionDefaultValue = uint256(value);
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionDefaultValue, 0);
        uint256 redeemerBalanceBefore = REDEEMER.balance;

        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(executor);

        vm.prank(caller);
        harbor.executeDefault(buildProof(15, false), requestId);

        assertEq(harbor.defaultKeeperExecutor(), executor, "helper output");
        assertEq(assetManager.requestExecutor(requestId), address(harbor), "request executor");
        assertEq(REDEEMER.balance, redeemerBalanceBefore + redemptionDefaultValue, "redeemer recovered");
    }

    function assertCallerCanExecuteDefault(address caller) private {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 1 wei);
        uint256 callerBalanceBefore = caller.balance;

        vm.prank(caller);
        harbor.executeDefault(buildProof(16, false), requestId);

        assertEq(caller.balance, callerBalanceBefore + 1 wei, "caller received executor fee");
        assertTrue(assetManager.requestDefaulted(requestId), "defaulted");
    }
}

contract RejectingNativeReceiver {
    receive() external payable {
        revert("native rejected");
    }

    function executeDefault(
        HarborRedeemer harbor,
        IReferencedPaymentNonexistence.Proof calldata proof,
        uint256 redemptionRequestId
    ) external {
        harbor.executeDefault(proof, redemptionRequestId);
    }
}
