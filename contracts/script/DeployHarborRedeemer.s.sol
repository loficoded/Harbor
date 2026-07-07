// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {HarborRedeemer} from "../src/HarborRedeemer.sol";

interface DeploymentVm {
    function addr(uint256 privateKey) external returns (address);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envOr(string calldata name, bool defaultValue) external returns (bool);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function startBroadcast() external;
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployHarborRedeemer {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant COSTON2_FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    address public constant DRY_RUN_OWNER = 0x00000000000000000000000000000000000D00D1;

    struct DeploymentConfig {
        address assetManagerOrRegistry;
        bool resolveAssetManagerFromRegistry;
        address keeperExecutor;
        address owner;
        uint256 deployerPrivateKey;
    }

    event HarborRedeemerDeployed(
        address indexed harborRedeemer,
        address indexed assetManager,
        address indexed fAssetToken,
        address keeperExecutor,
        address owner,
        bool resolvedAssetManagerFromRegistry
    );

    function run() external returns (HarborRedeemer harborRedeemer) {
        DeploymentConfig memory config = readDeploymentConfig();

        _startBroadcast(config.deployerPrivateKey);
        harborRedeemer = deploy(config);
        vm.stopBroadcast();
    }

    function readDeploymentConfig() public returns (DeploymentConfig memory config) {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address defaultOwner = deployerPrivateKey == 0 ? DRY_RUN_OWNER : vm.addr(deployerPrivateKey);

        config = DeploymentConfig({
            assetManagerOrRegistry: vm.envOr(
                "HARBOR_ASSET_MANAGER_OR_REGISTRY_ADDRESS", COSTON2_FLARE_CONTRACT_REGISTRY
            ),
            resolveAssetManagerFromRegistry: vm.envOr("HARBOR_RESOLVE_ASSET_MANAGER_FROM_REGISTRY", true),
            keeperExecutor: vm.envOr("KEEPER_EXECUTOR_ADDRESS", address(0)),
            owner: vm.envOr("HARBOR_OWNER_ADDRESS", defaultOwner),
            deployerPrivateKey: deployerPrivateKey
        });
    }

    function deploy(DeploymentConfig memory config) public returns (HarborRedeemer harborRedeemer) {
        harborRedeemer = new HarborRedeemer(
            config.assetManagerOrRegistry,
            config.resolveAssetManagerFromRegistry,
            config.keeperExecutor,
            config.owner
        );

        emit HarborRedeemerDeployed(
            address(harborRedeemer),
            harborRedeemer.assetManagerAddress(),
            harborRedeemer.fAssetTokenAddress(),
            harborRedeemer.defaultKeeperExecutor(),
            harborRedeemer.owner(),
            config.resolveAssetManagerFromRegistry
        );
    }

    function _startBroadcast(uint256 deployerPrivateKey) private {
        if (deployerPrivateKey == 0) {
            vm.startBroadcast();
            return;
        }

        vm.startBroadcast(deployerPrivateKey);
    }
}
