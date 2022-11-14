// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Contract {
    uint256 _sum = 0;

    constructor() {
        uint256[6] memory array = [
            uint256(1),
            uint256(2),
            uint256(3),
            uint256(5),
            uint256(7),
            uint256(11)
        ];

        uint256 tmp = 0;

        for (uint256 i = 0; i < array.length; i++) {
            tmp += array[i];
        }

        _sum = tmp;
    }
}
