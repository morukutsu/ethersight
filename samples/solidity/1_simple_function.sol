// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Contract {
    function foo() public view returns (uint256) {
        uint256 a = 3;
        uint256 b = 2 + a;
        return b;
    }
}
