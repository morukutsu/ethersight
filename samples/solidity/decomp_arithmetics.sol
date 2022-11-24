// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Contract {
    constructor() {
        // Add
        {
            uint256 a = 1;
            uint256 b = 2;
            uint256 c = a + b;
        }

        {
            uint256 a = 1;
            uint256 b = 2;
            uint256 c = b - a;
        }
    }
}
