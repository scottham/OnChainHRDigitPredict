// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
/**
 * @title Convolution2D
 * @dev Conv2D
 */
contract Convolution2D {
    /**
     * @notice            Conv2D, supports multi bands
     * @param inputData   [in_channels][in_height][in_width]
     * @param kernel      [out_channels][in_channels][kernel_size][kernel_size]
     * @param bias        [out_channels]
     * @param padding     padding size (zero padding)
     * @param stride      stride
     * @return            [out_channels][out_height][out_width]
     */
    function conv2D(
        int[][][] memory inputData,
        int[][][][] memory kernel,
        int[] memory bias,
        uint padding,
        uint stride
    )
        public
        pure
        returns (int[][][] memory)
    {

        uint inChannels = inputData.length;
        require(inChannels > 0, "Input inChannels must be > 0");
        uint inHeight = inputData[0].length;
        require(inHeight > 0, "Input inHeight must be > 0");
        uint inWidth = inputData[0][0].length;
        require(inWidth > 0, "Input inWidth must be > 0");


        uint outChannels = kernel.length;
        require(outChannels > 0, "Kernel outChannels must be > 0");
        uint kernelSize = kernel[0][0].length;
        require(kernelSize > 0, "kernelSize must be > 0");

        require(bias.length == outChannels, "Bias length mismatch");

        uint outHeight = (inHeight + 2 * padding - kernelSize) / stride + 1;
        uint outWidth = (inWidth + 2 * padding - kernelSize) / stride + 1;

        int[][][] memory outputData = new int[][][](outChannels);
        for (uint oc = 0; oc < outChannels; oc++) {
            outputData[oc] = new int[][](outHeight);
            for (uint oh = 0; oh < outHeight; oh++) {
                outputData[oc][oh] = new int[](outWidth);
            }
        }

        for (uint oc = 0; oc < outChannels; oc++) {
            for (uint oh = 0; oh < outHeight; oh++) {
                for (uint ow = 0; ow < outWidth; ow++) {
                    int baseH = int(oh * stride) - int(padding);
                    int baseW = int(ow * stride) - int(padding);

                    int sumVal = _accumulateWindow(inputData, kernel, oc, baseH, baseW, kernelSize);
                    sumVal += bias[oc];

                    outputData[oc][oh][ow] = sumVal;
                }
            }
        }

        return outputData;
    }

    /**
     * @dev Inner accumulation for one output position. Extracted from conv2D
     *      purely to keep the stack shallow enough for the IR codegen -- the
     *      arithmetic and its ordering are identical to the inlined version.
     */
    function _accumulateWindow(
        int[][][] memory inputData,
        int[][][][] memory kernel,
        uint oc,
        int baseH,
        int baseW,
        uint kernelSize
    )
        private
        pure
        returns (int sumVal)
    {
        uint inChannels = inputData.length;
        int inHeight = int(inputData[0].length);
        int inWidth = int(inputData[0][0].length);

        // Cache nested references instead of re-indexing four levels deep on
        // every term; keeps the IR codegen's stack shallow and cuts gas.
        int[][][] memory outKernel = kernel[oc];

        for (uint ic = 0; ic < inChannels; ic++) {
            int[][] memory plane = inputData[ic];
            int[][] memory kernelPlane = outKernel[ic];

            for (uint kh = 0; kh < kernelSize; kh++) {
                int curH = baseH + int(kh);
                // Row entirely outside the input: contributes nothing.
                if (curH < 0 || curH >= inHeight) {
                    continue;
                }

                int[] memory inputRow = plane[uint(curH)];
                int[] memory kernelRow = kernelPlane[kh];

                for (uint kw = 0; kw < kernelSize; kw++) {
                    int curW = baseW + int(kw);
                    if (curW >= 0 && curW < inWidth) {
                        sumVal += inputRow[uint(curW)] * kernelRow[kw];
                    }
                }
            }
        }
    }

    /**
     * @notice 2D Max Pooling
     * @param inputData [in_channels][in_height][in_width]
     * @param poolSize  (e.g. 2 is 2x2)
     * @param poolStride (e.g. 2)
     * @return [in_channels][out_height][out_width]
     */
    function maxPool2D(
        int[][][] memory inputData,
        uint poolSize,
        uint poolStride
    )
        public
        pure
        returns (int[][][] memory)
    {
        uint inChannels = inputData.length;
        require(inChannels > 0, "Input inChannels must be > 0");

        uint inHeight = inputData[0].length;
        require(inHeight > 0, "Input inHeight must be > 0");

        uint inWidth = inputData[0][0].length;
        require(inWidth > 0, "Input inWidth must be > 0");


        uint outHeight = (inHeight - poolSize) / poolStride + 1;
        uint outWidth = (inWidth - poolSize) / poolStride + 1;

        int[][][] memory poolOutput = new int[][][](inChannels);
        for (uint ic = 0; ic < inChannels; ic++) {
            poolOutput[ic] = new int[][](outHeight);
            for (uint oh = 0; oh < outHeight; oh++) {
                poolOutput[ic][oh] = new int[](outWidth);
            }
        }

        for (uint ic = 0; ic < inChannels; ic++) {
            for (uint oh = 0; oh < outHeight; oh++) {
                for (uint ow = 0; ow < outWidth; ow++) {
                    uint startH = oh * poolStride;
                    uint startW = ow * poolStride;

                    int maxVal = type(int).min;
                    for (uint kh = 0; kh < poolSize; kh++) {
                        for (uint kw = 0; kw < poolSize; kw++) {
                            uint curH = startH + kh;
                            uint curW = startW + kw;
                            int val = inputData[ic][curH][curW];
                            if (val > maxVal) {
                                maxVal = val;
                            }
                        }
                    }

                    poolOutput[ic][oh][ow] = maxVal;
                }
            }
        }

        return poolOutput;
    }

    /**
     * @notice Flatten 3D data to 1D data
     * @param inputData [in_channels][in_height][in_width]
     * @return [in_channels * in_height * in_width]
     */
    function flatten3D(int[][][] memory inputData) public pure returns (int[] memory) {

        uint256 c = inputData.length;       // 10
        uint256 h = inputData[0].length;    // 7
        uint256 w = inputData[0][0].length; // 7
        
        int[] memory flat = new int[](c * h * w);

        uint256 index = 0;
        for (uint256 ic = 0; ic < c; ic++) {
            for (uint256 ih = 0; ih < h; ih++) {
                for (uint256 iw = 0; iw < w; iw++) {
                    flat[index] = inputData[ic][ih][iw];
                    index++;
                }
            }
        }
        return flat;
    }
}
