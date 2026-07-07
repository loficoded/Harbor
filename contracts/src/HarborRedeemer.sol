// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";
import {
    IReferencedPaymentNonexistence
} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";

interface IFlareContractRegistry {
    function getContractAddressByName(string calldata name) external view returns (address);
}

/// @notice Permissionless default executor for FXRP redemptions.
/// @dev Users must start redemptions directly on the FXRP AssetManager and nominate this contract
/// as executor for `executeDefault` to be permissionless through Harbor. Harbor intentionally does
/// not wrap `redeem`, because FAssets records the redemption caller as the redeemer and pays default
/// collateral to that recorded redeemer.
contract HarborRedeemer is Ownable, ReentrancyGuard {
    string public constant FXRP_ASSET_MANAGER_REGISTRY_NAME = "AssetManagerFXRP";

    IAssetManager private immutable fxrpAssetManager;
    IERC20 private immutable fxrpFAsset;

    address private defaultKeeperExecutorAddress;

    event DefaultKeeperExecutorUpdated(address indexed executor);
    event RedemptionDefaultForwarded(
        address indexed caller, uint256 indexed redemptionRequestId, uint256 forwardedExecutorFeeNatWei
    );

    error ZeroAddress();
    error AssetManagerResolutionFailed();
    error DirectNativeTransferRejected();
    error NativeForwardFailed();

    constructor(
        address assetManagerOrRegistry,
        bool resolveAssetManagerFromRegistry,
        address initialDefaultKeeperExecutor,
        address initialOwner
    ) Ownable(initialOwner) {
        if (assetManagerOrRegistry == address(0)) revert ZeroAddress();

        address resolvedAssetManager = resolveAssetManagerFromRegistry
            ? IFlareContractRegistry(assetManagerOrRegistry).getContractAddressByName(FXRP_ASSET_MANAGER_REGISTRY_NAME)
            : assetManagerOrRegistry;
        if (resolvedAssetManager == address(0)) revert AssetManagerResolutionFailed();

        fxrpAssetManager = IAssetManager(resolvedAssetManager);

        IERC20 resolvedFAsset = fxrpAssetManager.fAsset();
        if (address(resolvedFAsset) == address(0)) revert AssetManagerResolutionFailed();
        fxrpFAsset = resolvedFAsset;

        _setDefaultKeeperExecutor(
            initialDefaultKeeperExecutor == address(0) ? address(this) : initialDefaultKeeperExecutor
        );
    }

    receive() external payable {
        if (msg.sender != address(fxrpAssetManager)) revert DirectNativeTransferRejected();
    }

    function executeDefault(IReferencedPaymentNonexistence.Proof calldata proof, uint256 redemptionRequestId)
        external
        nonReentrant
    {
        uint256 balanceBefore = address(this).balance;

        fxrpAssetManager.redemptionPaymentDefault(proof, redemptionRequestId);

        uint256 executorFeeReceived = address(this).balance - balanceBefore;
        if (executorFeeReceived != 0) {
            _forwardNative(payable(msg.sender), executorFeeReceived);
        }

        emit RedemptionDefaultForwarded(msg.sender, redemptionRequestId, executorFeeReceived);
    }

    function setDefaultKeeperExecutor(address executor) external onlyOwner {
        if (executor == address(0)) revert ZeroAddress();
        _setDefaultKeeperExecutor(executor);
    }

    function assetManagerAddress() external view returns (address) {
        return address(fxrpAssetManager);
    }

    function fAssetTokenAddress() external view returns (address) {
        return address(fxrpFAsset);
    }

    function lotSizeUBA() external view returns (uint256) {
        return fxrpAssetManager.lotSize();
    }

    function assetDecimals() external view returns (uint8) {
        return fxrpAssetManager.getSettings().assetDecimals;
    }

    function defaultKeeperExecutor() external view returns (address) {
        return defaultKeeperExecutorAddress;
    }

    function _setDefaultKeeperExecutor(address executor) private {
        defaultKeeperExecutorAddress = executor;
        emit DefaultKeeperExecutorUpdated(executor);
    }

    function _forwardNative(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert NativeForwardFailed();
    }
}
