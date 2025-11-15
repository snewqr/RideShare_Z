// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract customer_serializer_base {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function dummy() public pure returns (uint256) {
        return 42;
    }
}

