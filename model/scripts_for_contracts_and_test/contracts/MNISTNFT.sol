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

    function _at(uint256[] storage words, uint256 i) private view returns (int256) {
        return int256(int8(uint8(words[i / WEIGHTS_PER_SLOT] >> ((i % WEIGHTS_PER_SLOT) * 8))));
    }

    /// Rebuild [n0][n1][k][k] from packed storage. Weights are packed in
    /// row-major order over [outChannel][inChannel][kernelRow][kernelCol],
    /// 32 int8 per word, least-significant byte first.
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

    /**
     * The client sends the weights already packed -- one 256-bit word per 32
     * int8 weights, row-major, least-significant byte first.
     *
     * Sent as int[] instead, a ~3,150-weight model is ~108 KB of calldata: the
     * ABI spends a full 32-byte word on every int8. That is ~1.7M gas of
     * calldata alone, and it is over MetaMask's JSON-RPC request size limit, so
     * minting from a browser wallet fails outright with "Request too large".
     * Packed, the same model is ~4 KB.
     *
     * The trade is that the int8 range check moves off-chain; a caller can only
     * corrupt the model in the token it is minting for itself. Lengths are
     * still checked here, so a mis-shaped upload cannot be stored.
     */
    function _requireWordCount(uint256 words, uint256 weights) private pure {
        require(words == (weights + WEIGHTS_PER_SLOT - 1) / WEIGHTS_PER_SLOT, "Packed length mismatch.");
    }

    function _storeConv1(
        ModelParams storage mp,
        uint16[3] calldata shape,
        uint256[] calldata packed,
        int[] calldata bias
    ) private {
        _requireWordCount(packed.length, uint256(shape[0]) * shape[1] * shape[2] * shape[2]);
        require(bias.length == shape[0], "Bias length mismatch.");
        mp.conv1Out = shape[0];
        mp.conv1In = shape[1];
        mp.conv1K = shape[2];
        mp.conv1Packed = packed;
        mp.conv1Bias = bias;
    }

    function _storeConv2(
        ModelParams storage mp,
        uint16[3] calldata shape,
        uint256[] calldata packed,
        int[] calldata bias
    ) private {
        _requireWordCount(packed.length, uint256(shape[0]) * shape[1] * shape[2] * shape[2]);
        require(bias.length == shape[0], "Bias length mismatch.");
        mp.conv2Out = shape[0];
        mp.conv2In = shape[1];
        mp.conv2K = shape[2];
        mp.conv2Packed = packed;
        mp.conv2Bias = bias;
    }

    function _storeFc(
        ModelParams storage mp,
        uint16[2] calldata shape,
        uint256[] calldata packed,
        int[] calldata bias
    ) private {
        _requireWordCount(packed.length, uint256(shape[0]) * shape[1]);
        require(bias.length == shape[0], "Bias length mismatch.");
        mp.fcOut = shape[0];
        mp.fcIn = shape[1];
        mp.fcPacked = packed;
        mp.fcBias = bias;
    }

    /// @param conv1Shape [outChannels, inChannels, kernelSize]
    /// @param fcShape    [outFeatures, inFeatures]
    function mint(
        uint16[3] calldata conv1Shape,
        uint256[] calldata conv1Packed,
        int[] calldata conv1Bias,
        uint16[3] calldata conv2Shape,
        uint256[] calldata conv2Packed,
        int[] calldata conv2Bias,
        uint16[2] calldata fcShape,
        uint256[] calldata fcPacked,
        int[] calldata fcBias
    ) external returns (uint256) {
        uint256 newTokenId = _tokenIds + 1;
        _safeMint(msg.sender, newTokenId);
        _tokenIds = newTokenId;

        ModelParams storage mp = _tokenModelParams[newTokenId];
        _storeConv1(mp, conv1Shape, conv1Packed, conv1Bias);
        _storeConv2(mp, conv2Shape, conv2Packed, conv2Bias);
        _storeFc(mp, fcShape, fcPacked, fcBias);

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
