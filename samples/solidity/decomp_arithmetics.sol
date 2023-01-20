// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Contract {
    uint256 output;

    constructor() {
        // Add
        {
            uint256 a = 1;
            uint256 b = 2;
            uint256 c = a + b;
        }

        unchecked {
            uint256 a = 4;
            uint256 b = 7;
            uint256 c = a + b;

            output = c;
        }

        {
            uint256 a = 1;
            uint256 b = 2;
            uint256 c = b - a;
        }
    }
}
