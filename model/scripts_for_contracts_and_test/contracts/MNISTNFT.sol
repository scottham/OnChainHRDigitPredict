// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * deploy Convolution2D.sol and FullyConnectedLayer.sol first，
 */
import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IConvolution2D {
    function conv2D(
        int[][][] memory inputData,
        int[][][][] memory kernel,
        int[] memory bias,
        uint padding,
        uint stride
    ) external pure returns (int[][][] memory);

    function maxPool2D(
        int[][][] memory inputData,
        uint poolSize,
        uint poolStride
    ) external pure returns (int[][][] memory);
    
    function flatten3D(
        int[][][] memory inputData
    ) external pure returns (int[] memory);
}

interface IFullyConnectedLayer {
    
    function fullyConnected(
        int256[] memory input,
        int256[][] memory weights,
        int256[] memory bias
    ) external pure returns (int256[] memory);

    function relu(int256 x) external pure returns (int256);

    function argmax(int256[] memory data) external pure returns (uint256);
}

/**
 * @title MNISTNFT
 */
contract MNISTNFT is ERC721 {
    uint256 private _tokenIds;


    IConvolution2D public conv2dContract;
    IFullyConnectedLayer public fcContract;

    // Models:
    //   conv1
    //   conv2
    //   fc
    struct ModelParams {

        int[][][][] conv1Weight;
        int[] conv1Bias;

        int[][][][] conv2Weight;
        int[] conv2Bias;

        int[][] fcWeight;
        int[] fcBias;
    }


    mapping(uint256 => ModelParams) private _tokenModelParams;

    constructor(address _conv2dContract, address _fcContract)
        ERC721("MNIST NFT", "MNIST")
    {
        conv2dContract = IConvolution2D(_conv2dContract);
        fcContract = IFullyConnectedLayer(_fcContract);
    }

    function mint(
        // conv1
        int[][][][] memory conv1Weight,
        int[] memory conv1Bias,
        // conv2
        int[][][][] memory conv2Weight,
        int[] memory conv2Bias,
        // fc
        int[][] memory fcWeight,
        int[] memory fcBias
    ) public returns (uint256) {

        uint256 newTokenId = _tokenIds + 1;
        _safeMint(msg.sender, newTokenId);
        _tokenIds = newTokenId;

        ModelParams storage mp = _tokenModelParams[newTokenId];
        mp.conv1Weight = conv1Weight;
        mp.conv1Bias = conv1Bias;

        mp.conv2Weight = conv2Weight;
        mp.conv2Bias = conv2Bias;

        mp.fcWeight = fcWeight;
        mp.fcBias = fcBias;

        return newTokenId;
    }

    // -------------------------------
    // (Conv2D : [channels][height][width])
    // -------------------------------
    function relu3D(int[][][] memory inputData) internal view returns (int[][][] memory) {
        uint256 c = inputData.length;
        if (c == 0) {
            return inputData;
        }
        uint256 h = inputData[0].length;
        if (h == 0) {
            return inputData;
        }
        uint256 w = inputData[0][0].length;

        for (uint256 ic = 0; ic < c; ic++) {
            for (uint256 ih = 0; ih < h; ih++) {
                for (uint256 iw = 0; iw < w; iw++) {
                    // ReLU
                    inputData[ic][ih][iw] = fcContract.relu(inputData[ic][ih][iw]);
                }
            }
        }
        return inputData;
    }


    // -------------------------------
    // inference: read nft model and do inference
    // -------------------------------
    /**
     * @param tokenId nft id
     * @param input28x28 image inputs
     * @return predictedLabel prediction [0..9]
     */
    function inference(uint256 tokenId, int[][] memory input28x28)
        public
        view
        returns (uint256 predictedLabel)
    {
        require(_ownerOf(tokenId) != address(0), "Token does not exist.");

        ModelParams storage mp = _tokenModelParams[tokenId];

        int[][][] memory inputData = new int[][][](1);
        inputData[0] = input28x28;

        // ========== conv1 ==========
        int[][][] memory conv1Out = conv2dContract.conv2D(
            inputData,
            mp.conv1Weight,
            mp.conv1Bias,
            /*padding=*/1,
            /*stride=*/1
        );


        // ReLU
        int[][][] memory relu1Out = relu3D(conv1Out);

        // MaxPool2D(kernel_size=2, stride=2)
        int[][][] memory pool1Out = conv2dContract.maxPool2D(
            relu1Out,
            /*poolSize=*/2,
            /*poolStride=*/2
        );


        // ========== conv2 ==========
        int[][][] memory conv2Out = conv2dContract.conv2D(
            pool1Out,
            mp.conv2Weight,
            mp.conv2Bias,
            /*padding=*/1,
            /*stride=*/1
        );

        // ReLU
        int[][][] memory relu2Out = relu3D(conv2Out);


        // MaxPool2D(kernel_size=2, stride=2)
        int[][][] memory pool2Out = conv2dContract.maxPool2D(
            relu2Out,
            /*poolSize=*/2,
            /*poolStride=*/2
        );



        // ========== flatten (展开) ==========
        int[] memory flattenOut = conv2dContract.flatten3D(pool2Out);

        // ========== FC ==========
        int[] memory fcOut = fcContract.fullyConnected(
            flattenOut,
            mp.fcWeight,
            mp.fcBias
        );
        
        // ========== argmax ==========
        uint256 predIndex = fcContract.argmax(fcOut);

        return predIndex;
    }
}
