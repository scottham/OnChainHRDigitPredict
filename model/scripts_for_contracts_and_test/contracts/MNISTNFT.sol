// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * deploy Convolution2D.sol and FullyConnectedLayer.sol first，
 */
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

    /// Weights are quantized to int8, so 32 of them share one 256-bit slot.
    uint256 private constant WEIGHTS_PER_SLOT = 32;

    // Models:
    //   conv1
    //   conv2
    //   fc
    //
    // Weights are stored packed rather than one int256 per slot. A model has
    // ~3,150 weights; a slot each costs ~63M gas to mint, past the per-tx gas
    // cap on some chains. Packed as int8 it is ~117 slots and ~2.3M gas.
    // Biases stay full width: they carry the accumulated scale of every
    // preceding layer and reach ~6e7, well outside int8. There are only 19 of
    // them, so packing them would save nothing.
    struct ModelParams {
        uint16 conv1Out;
        uint16 conv1In;
        uint16 conv1K;
        uint16 conv2Out;
        uint16 conv2In;
        uint16 conv2K;
        uint16 fcOut;
        uint16 fcIn;

        uint256[] conv1Packed;
        uint256[] conv2Packed;
        uint256[] fcPacked;

        int[] conv1Bias;
        int[] conv2Bias;
        int[] fcBias;
    }

    mapping(uint256 => ModelParams) private _tokenModelParams;

    constructor(address _conv2dContract, address _fcContract)
        ERC721("MNIST NFT", "MNIST")
    {
        conv2dContract = IConvolution2D(_conv2dContract);
        fcContract = IFullyConnectedLayer(_fcContract);
    }

    // -------------------------------
    // int8 packing
    // -------------------------------

    function _pack(int[] memory flat) private pure returns (uint256[] memory words) {
        words = new uint256[]((flat.length + WEIGHTS_PER_SLOT - 1) / WEIGHTS_PER_SLOT);
        for (uint256 i = 0; i < flat.length; i++) {
            int256 v = flat[i];
            require(v >= -128 && v <= 127, "Weight outside int8 range.");
            words[i / WEIGHTS_PER_SLOT] |= uint256(uint8(int8(v))) << ((i % WEIGHTS_PER_SLOT) * 8);
        }
    }

    function _at(uint256[] storage words, uint256 i) private view returns (int256) {
        return int256(int8(uint8(words[i / WEIGHTS_PER_SLOT] >> ((i % WEIGHTS_PER_SLOT) * 8))));
    }

    function _flatten4D(int[][][][] memory k) private pure returns (int[] memory flat) {
        uint256 n0 = k.length;
        uint256 n1 = k[0].length;
        uint256 n2 = k[0][0].length;
        uint256 n3 = k[0][0][0].length;
        flat = new int[](n0 * n1 * n2 * n3);
        uint256 idx;
        for (uint256 a = 0; a < n0; a++) {
            for (uint256 b = 0; b < n1; b++) {
                for (uint256 c = 0; c < n2; c++) {
                    for (uint256 d = 0; d < n3; d++) {
                        flat[idx++] = k[a][b][c][d];
                    }
                }
            }
        }
    }

    function _flatten2D(int[][] memory m) private pure returns (int[] memory flat) {
        uint256 n0 = m.length;
        uint256 n1 = m[0].length;
        flat = new int[](n0 * n1);
        uint256 idx;
        for (uint256 a = 0; a < n0; a++) {
            for (uint256 b = 0; b < n1; b++) {
                flat[idx++] = m[a][b];
            }
        }
    }

    /// Rebuild [n0][n1][k][k] from packed storage, in the order _flatten4D wrote.
    function _rebuild4D(uint256[] storage words, uint256 n0, uint256 n1, uint256 k)
        private
        view
        returns (int[][][][] memory out)
    {
        out = new int[][][][](n0);
        uint256 idx;
        for (uint256 a = 0; a < n0; a++) {
            out[a] = new int[][][](n1);
            for (uint256 b = 0; b < n1; b++) {
                out[a][b] = new int[][](k);
                for (uint256 c = 0; c < k; c++) {
                    out[a][b][c] = new int[](k);
                    for (uint256 d = 0; d < k; d++) {
                        out[a][b][c][d] = _at(words, idx++);
                    }
                }
            }
        }
    }

    function _rebuild2D(uint256[] storage words, uint256 n0, uint256 n1)
        private
        view
        returns (int[][] memory out)
    {
        out = new int[][](n0);
        uint256 idx;
        for (uint256 a = 0; a < n0; a++) {
            out[a] = new int[](n1);
            for (uint256 b = 0; b < n1; b++) {
                out[a][b] = _at(words, idx++);
            }
        }
    }

    // -------------------------------
    // mint: upload the weights, nothing else
    // -------------------------------

    function _storeConv1(ModelParams storage mp, int[][][][] memory weight, int[] memory bias) private {
        mp.conv1Out = uint16(weight.length);
        mp.conv1In = uint16(weight[0].length);
        mp.conv1K = uint16(weight[0][0].length);
        mp.conv1Packed = _pack(_flatten4D(weight));
        mp.conv1Bias = bias;
    }

    function _storeConv2(ModelParams storage mp, int[][][][] memory weight, int[] memory bias) private {
        mp.conv2Out = uint16(weight.length);
        mp.conv2In = uint16(weight[0].length);
        mp.conv2K = uint16(weight[0][0].length);
        mp.conv2Packed = _pack(_flatten4D(weight));
        mp.conv2Bias = bias;
    }

    function _storeFc(ModelParams storage mp, int[][] memory weight, int[] memory bias) private {
        mp.fcOut = uint16(weight.length);
        mp.fcIn = uint16(weight[0].length);
        mp.fcPacked = _pack(_flatten2D(weight));
        mp.fcBias = bias;
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
        _storeConv1(mp, conv1Weight, conv1Bias);
        _storeConv2(mp, conv2Weight, conv2Bias);
        _storeFc(mp, fcWeight, fcBias);

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
            _rebuild4D(mp.conv1Packed, mp.conv1Out, mp.conv1In, mp.conv1K),
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
            _rebuild4D(mp.conv2Packed, mp.conv2Out, mp.conv2In, mp.conv2K),
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
            _rebuild2D(mp.fcPacked, mp.fcOut, mp.fcIn),
            mp.fcBias
        );

        // ========== argmax ==========
        uint256 predIndex = fcContract.argmax(fcOut);

        return predIndex;
    }
}
