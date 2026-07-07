// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

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
