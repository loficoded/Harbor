// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HarborRedeemer} from "../src/HarborRedeemer.sol";
import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import {AssetManagerSettings} from "@flarenetwork/flare-periphery-contracts/coston2/data/AssetManagerSettings.sol";

interface Vm {
    function assume(bool condition) external;
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
}

interface IHarborDefaultExecutor {
    function executeDefault(IReferencedPaymentNonexistence.Proof calldata proof, uint256 redemptionRequestId) external;
}

contract HarborRedeemerTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event RedemptionDefaultForwarded(
        address indexed caller, uint256 indexed redemptionRequestId, uint256 forwardedExecutorFeeNatWei
    );
    event DefaultKeeperExecutorUpdated(address indexed executor);

    MockFAsset private fAsset;
    MockAssetManager private assetManager;
    HarborRedeemer private harbor;

    address private constant OWNER = address(0xA11CE);
    address private constant CALLER = address(0xB0B);
    address private constant DEFAULT_KEEPER = address(0xC0FFEE);
    uint256 private constant LOT_SIZE_UBA = 10_000_000;
    uint8 private constant ASSET_DECIMALS = 6;

    error AssertionFailed(string message);

    function setUp() public {
        fAsset = new MockFAsset(ASSET_DECIMALS);
        assetManager = new MockAssetManager(IERC20(address(fAsset)), LOT_SIZE_UBA, ASSET_DECIMALS);
        harbor = new HarborRedeemer(address(assetManager), false, DEFAULT_KEEPER, OWNER);
    }

    function testExposesConfiguredProtocolHelpers() public view {
        assertEq(harbor.assetManagerAddress(), address(assetManager), "asset manager");
        assertEq(harbor.fAssetTokenAddress(), address(fAsset), "fasset");
        assertEq(harbor.lotSizeUBA(), LOT_SIZE_UBA, "lot size");
        assertEq(uint256(harbor.assetDecimals()), uint256(ASSET_DECIMALS), "asset decimals");
        assertEq(harbor.defaultKeeperExecutor(), DEFAULT_KEEPER, "default keeper");
    }

    function testCanResolveAssetManagerFromRegistry() public {
        MockRegistry registry = new MockRegistry(address(assetManager));
        HarborRedeemer resolvedHarbor = new HarborRedeemer(address(registry), true, address(0), OWNER);

        assertEq(resolvedHarbor.assetManagerAddress(), address(assetManager), "resolved asset manager");
        assertEq(resolvedHarbor.fAssetTokenAddress(), address(fAsset), "resolved fasset");
        assertEq(resolvedHarbor.defaultKeeperExecutor(), address(resolvedHarbor), "zero default becomes harbor");
    }

    function testOwnerCanUpdateDefaultKeeperExecutor() public {
        address newKeeper = address(0xD00D);

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
        harbor.setDefaultKeeperExecutor(address(0xD00D));
    }

    function testDefaultKeeperExecutorCannotBeZero() public {
        vm.expectRevert(abi.encodeWithSelector(HarborRedeemer.ZeroAddress.selector));
        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(address(0));
    }

    function testExecuteDefaultIsPermissionlessAndForwardsProof() public {
        IReferencedPaymentNonexistence.Proof memory proof = buildProof(42, true);
        uint256 requestId = 123;

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, 0);

        vm.prank(CALLER);
        harbor.executeDefault(proof, requestId);

        assertEq(assetManager.lastDefaultCaller(), address(harbor), "asset manager caller");
        assertEq(assetManager.lastRedemptionRequestId(), requestId, "request id");
        assertEq(assetManager.lastVotingRound(), 42, "voting round");
        assertTrue(assetManager.lastCheckSourceAddresses(), "proof flag forwarded");
    }

    function testExecuteDefaultForwardsExecutorFeeToCaller() public {
        IReferencedPaymentNonexistence.Proof memory proof = buildProof(7, false);
        uint256 requestId = 456;
        uint256 executorFee = 1.25 ether;

        assetManager.setExecutorFeeNatWei(executorFee);
        vm.deal(address(assetManager), executorFee);
        vm.deal(CALLER, 0);

        vm.expectEmit(true, true, false, true, address(harbor));
        emit RedemptionDefaultForwarded(CALLER, requestId, executorFee);

        vm.prank(CALLER);
        harbor.executeDefault(proof, requestId);

        assertEq(CALLER.balance, executorFee, "caller fee");
        assertEq(address(harbor).balance, 0, "harbor retained native");
        assertEq(address(assetManager).balance, 0, "asset manager spent fee");
    }

    function testExecuteDefaultRemainsCallableWhenDefaultKeeperChanges() public {
        vm.prank(OWNER);
        harbor.setDefaultKeeperExecutor(address(0xD00D));

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(1, false), 1);

        assertEq(assetManager.lastDefaultCaller(), address(harbor), "still permissionless through harbor");
    }

    function testDirectNativeTransfersAreRejected() public {
        vm.deal(address(this), 1 ether);

        (bool success,) = address(harbor).call{value: 1 wei}("");

        assertFalse(success, "direct native transfer rejected");
        assertEq(address(harbor).balance, 0, "harbor retained native");
    }

    function testExecuteDefaultRejectsReentrancyFromAssetManager() public {
        assetManager.setAttemptReentrancy(true);

        vm.prank(CALLER);
        harbor.executeDefault(buildProof(9, false), 99);

        assertFalse(assetManager.reentrantCallSucceeded(), "reentrant call succeeded");
        assertTrue(assetManager.reentrantCallReverted(), "reentrant call reverted");
        assertEq(assetManager.defaultCallCount(), 1, "only outer default call completed");
    }

    function testFuzzExecuteDefaultAnyCallerAndFee(address caller, uint96 fee, uint64 votingRound, uint64 requestId)
        public
    {
        vm.assume(caller != address(0));
        vm.assume(caller != address(harbor));
        vm.assume(uint160(caller) > 0xffff);
        vm.assume(caller.code.length == 0);

        uint256 executorFee = uint256(fee);
        assetManager.setExecutorFeeNatWei(executorFee);
        vm.deal(address(assetManager), executorFee);
        vm.deal(caller, 0);

        vm.prank(caller);
        harbor.executeDefault(buildProof(votingRound, false), requestId);

        assertEq(assetManager.lastDefaultCaller(), address(harbor), "asset manager caller");
        assertEq(assetManager.lastRedemptionRequestId(), uint256(requestId), "fuzz request id");
        assertEq(assetManager.lastVotingRound(), votingRound, "fuzz voting round");
        assertEq(caller.balance, executorFee, "fuzz caller fee");
        assertEq(address(harbor).balance, 0, "fuzz harbor retained native");
    }

    function buildProof(uint64 votingRound, bool checkSourceAddresses)
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

    function assertTrue(bool actual, string memory message) private pure {
        if (!actual) revert AssertionFailed(message);
    }

    function assertFalse(bool actual, string memory message) private pure {
        if (actual) revert AssertionFailed(message);
    }

    function assertEq(address actual, address expected, string memory message) private pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertEq(uint8 actual, uint8 expected, string memory message) private pure {
        if (actual != expected) revert AssertionFailed(message);
    }
}

contract MockRegistry {
    address private immutable resolvedAssetManager;

    constructor(address assetManager) {
        resolvedAssetManager = assetManager;
    }

    function getContractAddressByName(string calldata name) external view returns (address) {
        if (keccak256(bytes(name)) == keccak256(bytes("AssetManagerFXRP"))) {
            return resolvedAssetManager;
        }
        return address(0);
    }
}

contract MockFAsset {
    uint8 public immutable decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }
}

contract MockAssetManager {
    IERC20 public immutable fAsset;

    uint256 private immutable lotSizeValue;
    AssetManagerSettings.Data private settings;

    address public lastDefaultCaller;
    uint256 public lastRedemptionRequestId;
    uint64 public lastVotingRound;
    bool public lastCheckSourceAddresses;
    uint256 public defaultCallCount;
    bool public reentrantCallSucceeded;
    bool public reentrantCallReverted;

    uint256 private executorFeeNatWei;
    bool private attemptReentrancy;

    constructor(IERC20 fAsset_, uint256 lotSizeUBA_, uint8 assetDecimals_) {
        fAsset = fAsset_;
        lotSizeValue = lotSizeUBA_;
        settings.assetDecimals = assetDecimals_;
    }

    receive() external payable {}

    function setExecutorFeeNatWei(uint256 executorFeeNatWei_) external {
        executorFeeNatWei = executorFeeNatWei_;
    }

    function setAttemptReentrancy(bool attemptReentrancy_) external {
        attemptReentrancy = attemptReentrancy_;
    }

    function lotSize() external view returns (uint256) {
        return lotSizeValue;
    }

    function getSettings() external view returns (AssetManagerSettings.Data memory) {
        return settings;
    }

    function redemptionPaymentDefault(IReferencedPaymentNonexistence.Proof calldata proof, uint256 redemptionRequestId)
        external
    {
        defaultCallCount++;
        lastDefaultCaller = msg.sender;
        lastRedemptionRequestId = redemptionRequestId;
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

        uint256 fee = executorFeeNatWei;
        executorFeeNatWei = 0;
        if (fee != 0) {
            (bool success,) = payable(msg.sender).call{value: fee}("");
            require(success, "executor fee transfer failed");
        }
    }
}
