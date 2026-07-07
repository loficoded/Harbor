// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockFAsset is IERC20 {
    enum TransferBehavior {
        Succeeds,
        ReturnsFalse,
        Reverts
    }

    string public constant name = "Mock FAsset";
    string public constant symbol = "mFASSET";

    uint8 public immutable decimals;
    uint256 public override totalSupply;

    mapping(address account => uint256 balance) private balances;
    mapping(address owner => mapping(address spender => uint256 allowanceAmount)) private allowances;

    TransferBehavior private transferBehavior;
    address private reentrancyTarget;
    bytes private reentrancyCalldata;

    bool public reentrantCallSucceeded;
    bool public reentrantCallReverted;

    error ConfiguredTransferRevert();
    error InsufficientAllowance();
    error InsufficientBalance();
    error ZeroAddress();

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setTransferBehavior(TransferBehavior behavior) external {
        transferBehavior = behavior;
    }

    function setReentrancyAttempt(address target, bytes calldata callData) external {
        reentrancyTarget = target;
        reentrancyCalldata = callData;
        reentrantCallSucceeded = false;
        reentrantCallReverted = false;
    }

    function mint(address account, uint256 amount) external {
        if (account == address(0)) revert ZeroAddress();

        totalSupply += amount;
        balances[account] += amount;

        emit Transfer(address(0), account, amount);
    }

    function burn(address account, uint256 amount) external {
        if (balances[account] < amount) revert InsufficientBalance();

        balances[account] -= amount;
        totalSupply -= amount;

        emit Transfer(account, address(0), amount);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (!_configuredTransferCanProceed()) return false;

        _transfer(msg.sender, to, amount);
        _attemptReentrancy();

        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowances[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (!_configuredTransferCanProceed()) return false;

        uint256 currentAllowance = allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            allowances[from][msg.sender] = currentAllowance - amount;
        }

        _transfer(from, to, amount);
        _attemptReentrancy();

        return true;
    }

    function _configuredTransferCanProceed() private view returns (bool) {
        if (transferBehavior == TransferBehavior.Reverts) revert ConfiguredTransferRevert();
        if (transferBehavior == TransferBehavior.ReturnsFalse) return false;
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (balances[from] < amount) revert InsufficientBalance();

        balances[from] -= amount;
        balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _attemptReentrancy() private {
        address target = reentrancyTarget;
        if (target == address(0)) return;

        bytes memory callData = reentrancyCalldata;
        reentrancyTarget = address(0);
        reentrancyCalldata = "";

        (bool success,) = target.call(callData);
        if (success) {
            reentrantCallSucceeded = true;
        } else {
            reentrantCallReverted = true;
        }
    }
}
