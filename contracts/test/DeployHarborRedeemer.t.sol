// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DeployHarborRedeemer} from "../script/DeployHarborRedeemer.s.sol";
import {HarborRedeemer} from "../src/HarborRedeemer.sol";
import {HarborRedeemerTestBase} from "./helpers/HarborRedeemerTestBase.sol";

contract DeployHarborRedeemerTest is HarborRedeemerTestBase {
    function testDeployScriptCanDryRunWithLocalAssetManagerAndNoPrivateKey() public {
        deployHarborFixture(LOT_SIZE_UBA, ASSET_DECIMALS, DEFAULT_KEEPER);

        DeployHarborRedeemer script = new DeployHarborRedeemer();
        DeployHarborRedeemer.DeploymentConfig memory config = DeployHarborRedeemer.DeploymentConfig({
            assetManagerOrRegistry: address(assetManager),
            resolveAssetManagerFromRegistry: false,
            keeperExecutor: address(0),
            owner: OWNER,
            deployerPrivateKey: 0
        });

        HarborRedeemer deployedHarbor = script.deploy(config);

        assertEq(deployedHarbor.owner(), OWNER, "owner");
        assertEq(deployedHarbor.assetManagerAddress(), address(assetManager), "asset manager");
        assertEq(deployedHarbor.fAssetTokenAddress(), address(fAsset), "fasset");
        assertEq(deployedHarbor.lotSizeUBA(), LOT_SIZE_UBA, "lot size");
        assertEq(uint256(deployedHarbor.assetDecimals()), uint256(ASSET_DECIMALS), "asset decimals");
        assertEq(deployedHarbor.defaultKeeperExecutor(), address(deployedHarbor), "default keeper");
    }

    function testDeployScriptUsesConfiguredKeeperExecutor() public {
        deployHarborFixture(LOT_SIZE_UBA, ASSET_DECIMALS, DEFAULT_KEEPER);

        DeployHarborRedeemer script = new DeployHarborRedeemer();
        DeployHarborRedeemer.DeploymentConfig memory config = DeployHarborRedeemer.DeploymentConfig({
            assetManagerOrRegistry: address(assetManager),
            resolveAssetManagerFromRegistry: false,
            keeperExecutor: DEFAULT_KEEPER,
            owner: OWNER,
            deployerPrivateKey: 0
        });

        HarborRedeemer deployedHarbor = script.deploy(config);

        assertEq(deployedHarbor.defaultKeeperExecutor(), DEFAULT_KEEPER, "default keeper");
    }
}
