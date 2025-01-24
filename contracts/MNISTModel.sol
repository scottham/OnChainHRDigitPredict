// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title HandwrittenDigitModel16x16
 * @dev Single Linear Layer Model (16 * 16 -> 10)。
 */
contract HandwrittenDigitModel16x16 is ERC721, Ownable {

    struct Model {
        int256[2560] weights;
        int256[10]   biases;
    }

    mapping(uint256 => Model) internal models;
    function getModel(uint256 tokenId) public view returns (int256[2560] memory weights, int256[10] memory biases) {
    Model storage m = models[tokenId];
    return (m.weights, m.biases);
    }

    constructor() ERC721("DigitModel16x16", "DM16") Ownable(msg.sender) {}

    function mintModel(
        uint256 tokenId,
        int256[2560] memory _weights,
        int256[10]   memory _biases
    ) public onlyOwner {
        models[tokenId] = Model(_weights, _biases);
        _safeMint(msg.sender, tokenId);
    }

    function predictDigit(
        uint256 tokenId,
        int256[256] memory input
    ) public view returns (uint256) 
    {
        Model storage m = models[tokenId];
        int256 maxVal = type(int256).min;
        uint256 maxIndex = 0;

        for (uint256 o = 0; o < 10; o++) {
            int256 sum = m.biases[o];
            uint256 baseIndex = o * 256;
            for (uint256 i = 0; i < 256; i++) {
                sum += m.weights[baseIndex + i] * input[i];
            }
            if (sum > maxVal) {
                maxVal = sum;
                maxIndex = o;
            }
        }
        return maxIndex;
    }
}
