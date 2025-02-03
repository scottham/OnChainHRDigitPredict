// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FullyConnectedLayer {
    

    /**
     * @dev FC layer
     */
    function fullyConnected(
        int256[] memory input,
        int256[][] memory weights,
        int256[] memory bias
    ) public pure returns (int256[] memory) 
    {

        uint256 outputSize = weights.length;
        

        uint256 inputSize = input.length;

        require(outputSize == bias.length, "Weights and bias size mismatch.");
        

        for (uint256 j = 0; j < outputSize; j++) {
            require(weights[j].length == inputSize, "Weight row size mismatch with input size.");
        }


        int256[] memory output = new int256[](outputSize);

        for (uint256 j = 0; j < outputSize; j++) {
            int256 sumVal = 0;
            for (uint256 i = 0; i < inputSize; i++) {
                sumVal += input[i] * weights[j][i];
            }
            sumVal += bias[j];
            output[j] = sumVal;
        }

        return output;
    }

    /**
     * @dev ReLU
     */
    function relu(int256 x) public pure returns (int256) {
        if (x < 0) {
            return 0;
        }
        return x;
    }

    /**
     * @dev torch.argmax
     */
    function argmax(int256[] memory data) public pure returns (uint256 idx) {
        require(data.length > 0, "Data array cannot be empty.");

        int256 maxVal = data[0];
        uint256 maxIndex = 0;
        for (uint256 i = 1; i < data.length; i++) {
            if (data[i] > maxVal) {
                maxVal = data[i];
                maxIndex = i;
            }
        }
        return maxIndex;
    }
}
