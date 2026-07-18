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
import {
    IXRPPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistence.sol";

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

    // -----------------------------------------------------------------------
    // executeXrpDefault (redeem-by-tag default lane)
    // -----------------------------------------------------------------------

    function testExecuteXrpDefaultIsPermissionlessAndForwardsXrpProof() public {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        IXRPPaymentNonexistence.Proof memory proof = buildXrpProof(42, 7, true);

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, 0);

        vm.prank(CALLER);
        harbor.executeXrpDefault(proof, requestId);

        assertEq(assetManager.lastXrpDefaultCaller(), address(harbor), "xrp default forwarded to asset manager");
        assertEq(assetManager.lastXrpRedemptionRequestId(), requestId, "xrp request id forwarded");
        assertEq(assetManager.xrpDefaultCallCount(), 1, "xrp default called once");
        assertEq(assetManager.lastXrpProofHash(), xrpProofHash(proof), "xrp proof forwarded byte-for-byte");
        assertTrue(assetManager.lastCheckDestinationTag(), "checkDestinationTag forwarded");
        assertTrue(assetManager.lastCheckFirstMemoData(), "checkFirstMemoData forwarded");
        assertEq(assetManager.lastDestinationTag(), 7, "destinationTag forwarded");
        assertEq(assetManager.defaultCallCount(), 0, "standard default not called");
    }

    function testExecuteXrpDefaultDoesNotRequireOwnerKeeperOrRedeemerCaller() public {
        assertCallerCanExecuteXrpDefault(OWNER);
        assertCallerCanExecuteXrpDefault(DEFAULT_KEEPER);
        assertCallerCanExecuteXrpDefault(REDEEMER);
        assertCallerCanExecuteXrpDefault(CALLER);
    }

    function testExecuteXrpDefaultForwardsExecutorFeeToCaller() public {
        uint256 executorFee = 1.25 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);
        uint256 callerBalanceBefore = CALLER.balance;

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(43, 0, true), requestId);

        assertEq(CALLER.balance, callerBalanceBefore + executorFee, "caller received xrp executor fee");
        assertEq(address(harbor).balance, 0, "harbor retained no native");
        assertEq(address(assetManager).balance, 0, "asset manager drained");
    }

    function testExecuteXrpDefaultPaysUserRecoveryValueDirectlyToRedeemer() public {
        uint256 redemptionValue = 5 ether;
        uint256 executorFee = 0.2 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionValue, executorFee);
        uint256 redeemerBalanceBefore = REDEEMER.balance;

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(44, 12345, true), requestId);

        assertEq(REDEEMER.balance, redeemerBalanceBefore + redemptionValue, "redeemer recovered collateral");
        assertEq(assetManager.defaultValuePaidTo(REDEEMER), redemptionValue, "redeemer paid directly");
        assertEq(assetManager.executorFeePaidTo(address(harbor)), executorFee, "harbor paid fee");
        assertEq(address(harbor).balance, 0, "harbor holds no native");
        assertEq(fAsset.balanceOf(address(harbor)), 0, "harbor holds no fasset");
    }

    function testExecuteXrpDefaultLeavesNoHarborTokenOrNativeBalance() public {
        uint256 redemptionValue = 3 ether;
        uint256 executorFee = 0.5 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionValue, executorFee);

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(45, 4294967295, true), requestId);

        assertEq(fAsset.balanceOf(address(harbor)), 0, "no fasset retained");
        assertEq(address(harbor).balance, 0, "no native retained");
        assertTrue(assetManager.requestDefaulted(requestId), "request defaulted");
    }

    function testExecuteXrpDefaultRejectsReentrancyFromAssetManager() public {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        assetManager.setAttemptReentrancy(true);

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(46, 1, true), requestId);

        assertFalse(assetManager.reentrantCallSucceeded(), "reentrant call succeeded");
        assertTrue(assetManager.reentrantCallReverted(), "reentrant call reverted");
        assertEq(assetManager.xrpDefaultCallCount(), 1, "only outer xrp default completed");
    }

    function testExecuteXrpDefaultRevertsWhenExecutorFeeForwardFails() public {
        RejectingNativeReceiver rejectingCaller = new RejectingNativeReceiver();
        uint256 executorFee = 1 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);

        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.NativeForwardFailed.selector));
        rejectingCaller.executeXrpDefault(harbor, buildXrpProof(47, 9, true), requestId);

        assertFalse(assetManager.requestDefaulted(requestId), "request not defaulted");
        assertEq(address(harbor).balance, 0, "harbor retained native");
        assertEq(address(assetManager).balance, executorFee, "asset manager balance restored");
    }

    function testExecuteXrpDefaultRevertsWhenAssetManagerReverts() public {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        // Default the request once, so the second call reverts "already defaulted".
        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(48, 0, true), requestId);

        vm.expectRevert(bytes("request already defaulted"));
        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(49, 0, true), requestId);
    }

    function testExecuteXrpDefaultAndExecuteDefaultAreIsolatedLanes() public {
        // A standard default must not invoke the XRP path and vice-versa.
        uint256 standardRequestId = openDefaultRequest(REDEEMER, 0, 0);
        vm.prank(CALLER);
        harbor.executeDefault(buildProof(50, false), standardRequestId);
        assertEq(assetManager.defaultCallCount(), 1, "standard default called");
        assertEq(assetManager.xrpDefaultCallCount(), 0, "xrp default not called");

        uint256 xrpRequestId = openDefaultRequest(REDEEMER, 0, 0);
        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(51, 42, true), xrpRequestId);
        assertEq(assetManager.defaultCallCount(), 1, "standard default unchanged");
        assertEq(assetManager.xrpDefaultCallCount(), 1, "xrp default called");
    }

    // -----------------------------------------------------------------------
    // executeXrpDefault (redeem-by-tag) — extended invariant coverage
    // -----------------------------------------------------------------------

    function testFuzzExecuteXrpDefaultAnyTagAndAmount(uint32 destinationTag, uint96 amount) public {
        // For any uint32 destination tag and any recovery value, the XRP default
        // succeeds, forwards the exact tag, keeps both check flags set, and pays
        // the recovered value straight through to the redeemer.
        uint256 redemptionValue = uint256(amount);
        uint256 requestId = openDefaultRequest(REDEEMER, redemptionValue, 0);
        uint256 redeemerBalanceBefore = REDEEMER.balance;

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(7, uint256(destinationTag), true), requestId);

        assertTrue(assetManager.requestDefaulted(requestId), "defaulted for any tag/amount");
        assertEq(assetManager.lastDestinationTag(), uint256(destinationTag), "tag forwarded");
        assertTrue(assetManager.lastCheckDestinationTag(), "checkDestinationTag true");
        assertTrue(assetManager.lastCheckFirstMemoData(), "checkFirstMemoData true");
        assertEq(REDEEMER.balance, redeemerBalanceBefore + redemptionValue, "redeemer paid recovery value");
        assertEq(address(harbor).balance, 0, "harbor retained no native");
    }

    function testExecuteXrpDefaultForwardsCheckDestinationTagFalseVerbatim() public {
        // The proof's check flags are forwarded byte-for-byte, never hardcoded:
        // a proof with checkDestinationTag=false reaches the AssetManager false,
        // proving Harbor does not fabricate or coerce proof fields.
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        IXRPPaymentNonexistence.Proof memory proof = buildXrpProof(60, 4242, false);

        vm.prank(CALLER);
        harbor.executeXrpDefault(proof, requestId);

        assertFalse(assetManager.lastCheckDestinationTag(), "checkDestinationTag=false forwarded verbatim");
        assertTrue(assetManager.lastCheckFirstMemoData(), "checkFirstMemoData forwarded");
        assertEq(assetManager.lastDestinationTag(), 4242, "destinationTag forwarded");
        assertEq(assetManager.lastXrpProofHash(), xrpProofHash(proof), "xrp proof forwarded byte-for-byte");
    }

    function testExecuteXrpDefaultEmitsForwardedEventWithExecutorFee() public {
        // A non-zero executor fee is reflected in the RedemptionDefaultForwarded
        // event (caller, requestId, fee) and forwarded to the caller.
        uint256 executorFee = 0.75 ether;
        uint256 requestId = openDefaultRequest(REDEEMER, 0, executorFee);
        uint256 callerBalanceBefore = CALLER.balance;

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, executorFee);

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(61, 5, true), requestId);

        assertEq(CALLER.balance, callerBalanceBefore + executorFee, "caller received forwarded fee");
    }

    function testExecuteXrpDefaultZeroExecutorFeeForwardsNoNative() public {
        // With a zero executor fee, no native is forwarded (the caller balance is
        // unchanged), the event carries 0, and Harbor holds nothing.
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 0);
        uint256 callerBalanceBefore = CALLER.balance;

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, 0);

        vm.prank(CALLER);
        harbor.executeXrpDefault(buildXrpProof(62, 0, true), requestId);

        assertEq(CALLER.balance, callerBalanceBefore, "no native forwarded on zero fee");
        assertEq(address(harbor).balance, 0, "harbor retained no native");
        assertEq(assetManager.xrpDefaultCallCount(), 1, "xrp default executed once");
    }

    function testExecuteXrpDefaultPermissionlessIncludingAgentOwner() public {
        // The full enumerated caller set — including the agent owner and an
        // otherwise-unrelated address — can trigger the permissionless XRP
        // default (the AssetManager only ever sees Harbor as its caller).
        assertCallerCanExecuteXrpDefault(AGENT_OWNER);
        assertCallerCanExecuteXrpDefault(address(0xF00DF00D));
    }

    function testExecuteDefaultCannotReenterXrpDefaultCrossLane() public {
        // The ReentrancyGuard is shared across both default lanes: a reentrant
        // executeXrpDefault attempted from within executeDefault (via the
        // executor-fee callback) reverts, while the outer default still succeeds
        // and the reentrant XRP request is never touched.
        CrossLaneReentrantCaller attacker = new CrossLaneReentrantCaller(harbor);
        uint256 standardRequestId = openDefaultRequest(REDEEMER, 0, 1 ether);
        uint256 xrpRequestId = openDefaultRequest(REDEEMER, 0, 0);

        attacker.attack(buildProof(70, false), standardRequestId, xrpRequestId);

        assertTrue(attacker.reenteredXrp(), "reentrancy attempted");
        assertTrue(attacker.reentrantReverted(), "cross-lane reentrancy reverted");
        assertEq(assetManager.defaultCallCount(), 1, "only outer standard default completed");
        assertEq(assetManager.xrpDefaultCallCount(), 0, "reentrant xrp default never executed");
        assertTrue(assetManager.requestDefaulted(standardRequestId), "outer default succeeded");
        assertFalse(assetManager.requestDefaulted(xrpRequestId), "reentrant xrp request untouched");
        assertEq(address(attacker).balance, 1 ether, "executor fee forwarded to caller");
    }

    function testFuzzExecuteXrpDefaultAnyCallerTagAndFee(
        address caller,
        uint96 fee,
        uint64 votingRound,
        uint32 destinationTag
    ) public {
        vm.assume(caller != address(0));
        vm.assume(uint160(caller) > 0xffff);
        vm.assume(caller.code.length == 0);

        uint256 requestId = openDefaultRequest(REDEEMER, 0, uint256(fee));
        uint256 callerBalanceBefore = caller.balance;
        if (fee != 0) {
            fundAssetManager(uint256(fee));
        }

        vm.prank(caller);
        harbor.executeXrpDefault(buildXrpProof(votingRound, uint256(destinationTag), true), requestId);

        assertEq(caller.balance, callerBalanceBefore + uint256(fee), "caller received fee");
        assertEq(address(harbor).balance, 0, "harbor retains no native");
        assertEq(fAsset.balanceOf(address(harbor)), 0, "harbor retains no fasset");
        assertTrue(assetManager.requestDefaulted(requestId), "defaulted");
        assertEq(assetManager.lastDestinationTag(), uint256(destinationTag), "tag forwarded");
    }

    function assertCallerCanExecuteXrpDefault(address caller) private {
        uint256 requestId = openDefaultRequest(REDEEMER, 0, 1 wei);
        uint256 callerBalanceBefore = caller.balance;

        vm.prank(caller);
        harbor.executeXrpDefault(buildXrpProof(52, 0, true), requestId);

        assertEq(caller.balance, callerBalanceBefore + 1 wei, "caller received xrp executor fee");
        assertTrue(assetManager.requestDefaulted(requestId), "defaulted");
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

    function executeXrpDefault(
        HarborRedeemer harbor,
        IXRPPaymentNonexistence.Proof calldata proof,
        uint256 redemptionRequestId
    ) external {
        harbor.executeXrpDefault(proof, redemptionRequestId);
    }
}

/// @dev Attempts a cross-lane reentrancy. While Harbor forwards the executor fee
/// during `executeDefault`, this caller's `receive` re-enters `executeXrpDefault`.
/// The reentrant call must revert (shared ReentrancyGuard), which this contract
/// catches so the outer default can complete — proving the guard spans both lanes.
contract CrossLaneReentrantCaller {
    HarborRedeemer private immutable harbor;

    bool public reenteredXrp;
    bool public reentrantReverted;
    uint256 private pendingXrpRequestId;

    constructor(HarborRedeemer harbor_) {
        harbor = harbor_;
    }

    function attack(
        IReferencedPaymentNonexistence.Proof calldata standardProof,
        uint256 standardRequestId,
        uint256 xrpRequestId
    ) external {
        pendingXrpRequestId = xrpRequestId;
        harbor.executeDefault(standardProof, standardRequestId);
    }

    receive() external payable {
        if (reenteredXrp) {
            return;
        }
        reenteredXrp = true;

        // An empty proof is sufficient: the nonReentrant guard reverts before the
        // proof body is ever read.
        IXRPPaymentNonexistence.Proof memory proof;
        proof.merkleProof = new bytes32[](0);
        try harbor.executeXrpDefault(proof, pendingXrpRequestId) {
            // Unreachable: the shared guard blocks cross-lane reentry.
        } catch {
            reentrantReverted = true;
        }
    }
}
