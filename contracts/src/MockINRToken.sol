// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Mock INR Test Token
/// @notice Minimal ERC-20-compatible token used only in the local Aegis EVM sandbox.
/// @dev This contract is test infrastructure. It is not currency, a stablecoin, or a production asset.
contract MockINRToken {
    string public constant name = "Mock INR Test Token";
    string public constant symbol = "mINR-TEST";
    uint8 public constant decimals = 0;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientAllowance(uint256 available, uint256 required);

    constructor(uint256 testSupply) {
        totalSupply = testSupply;
        balanceOf[msg.sender] = testSupply;
        emit Transfer(address(0), msg.sender, testSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            if (permitted < amount) revert InsufficientAllowance(permitted, amount);
            allowance[from][msg.sender] = permitted - amount;
            emit Approval(from, msg.sender, permitted - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = balanceOf[from];
        if (available < amount) revert InsufficientBalance(available, amount);
        unchecked {
            balanceOf[from] = available - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
