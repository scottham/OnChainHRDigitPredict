// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * NOT PART OF THE DEPLOYED SYSTEM. A benchmark, kept next to the contracts it
 * measures so the two cannot drift apart. Nothing mints it or calls it; it is
 * injected into an `eth_call` state override by scripts/bench-conv.mjs and
 * exists to answer one question with a number instead of an argument: how much
 * of a neural network's data parallelism can an EVM contract actually use?
 *
 * Two implementations of the same conv1 layer: 1 input channel, 3 output
 * channels, 3x3 kernel, 28x28, padding 1, followed by ReLU.
 *
 * `convNaive` mirrors the shape the deployed Convolution2D uses -- one int256
 * per activation, in int[][][] memory. `convPacked` puts eight activations in
 * every 256-bit word and multiplies all eight by a broadcast weight in one
 * MUL, which is the same data parallelism a GPU exploits, at width 8.
 *
 * Both return a checksum of the post-ReLU output so neither can be optimised
 * away and so the two can be checked against each other.
 */
contract ConvBench {
    uint256 private constant LANES = 8;
    uint256 private constant LANE_BITS = 32;
    uint256 private constant LANE_MASK = 0xffffffff;
    uint256 private constant WORDS = 4; // 28 lanes -> 4 words
    uint256 private constant N = 28;

    uint256[512] private slots;

    // ---------------------------------------------------------------- naive

    function convNaive(
        int256[][] memory input,
        int256[][][] memory kernel,
        int256[] memory bias
    ) public pure returns (uint256 checksum) {
        uint256 outC = kernel.length;
        int256[][][] memory out = new int256[][][](outC);

        for (uint256 oc = 0; oc < outC; oc++) {
            out[oc] = new int256[][](N);
            for (uint256 y = 0; y < N; y++) {
                out[oc][y] = new int256[](N);
                for (uint256 x = 0; x < N; x++) {
                    int256 acc = bias[oc];
                    for (uint256 ky = 0; ky < 3; ky++) {
                        int256 iy = int256(y) + int256(ky) - 1;
                        if (iy < 0 || iy >= int256(N)) continue;
                        for (uint256 kx = 0; kx < 3; kx++) {
                            int256 ix = int256(x) + int256(kx) - 1;
                            if (ix < 0 || ix >= int256(N)) continue;
                            acc += input[uint256(iy)][uint256(ix)] * kernel[oc][ky][kx];
                        }
                    }
                    if (acc < 0) acc = 0;
                    out[oc][y][x] = acc;
                }
            }
        }

        unchecked {
            for (uint256 oc = 0; oc < outC; oc++)
                for (uint256 y = 0; y < N; y++)
                    for (uint256 x = 0; x < N; x++) checksum += uint256(out[oc][y][x]);
        }
    }

    // --------------------------------------------------------------- packed

    /** One input row shifted by `d` lanes, so lane x holds the value at x + d. */
    function shiftRow(uint256[] calldata rows, uint256 iy, int256 d)
        private pure returns (uint256[WORDS] memory v)
    {
        uint256 base = iy * WORDS;
        unchecked {
            if (d == 0) {
                for (uint256 j = 0; j < WORDS; j++) v[j] = rows[base + j];
            } else if (d == 1) {
                for (uint256 j = 0; j < WORDS; j++) {
                    uint256 hi = j + 1 < WORDS ? rows[base + j + 1] : 0;
                    v[j] = (rows[base + j] >> LANE_BITS) | (hi << ((LANES - 1) * LANE_BITS));
                }
            } else {
                for (uint256 j = WORDS; j > 0; j--) {
                    uint256 lo = j >= 2 ? rows[base + j - 2] : 0;
                    v[j - 1] = (rows[base + j - 1] << LANE_BITS) | (lo >> ((LANES - 1) * LANE_BITS));
                }
            }
        }
    }

    function convPacked(
        uint256[] calldata rows,
        int256[][][] memory kernel,
        int256[] memory bias
    ) public pure returns (uint256 checksum) {
        uint256 outC = kernel.length;

        unchecked {
            for (uint256 y = 0; y < N; y++) {
                // Weights are int8, activations 0..255, at most 9 terms:
                // a lane peaks near 2^18, so nothing carries into its neighbour
                // and positive and negative parts can be accumulated separately.
                uint256[WORDS][3] memory pos;
                uint256[WORDS][3] memory neg;

                for (uint256 ky = 0; ky < 3; ky++) {
                    int256 iy = int256(y) + int256(ky) - 1;
                    if (iy < 0 || iy >= int256(N)) continue;

                    for (uint256 kx = 0; kx < 3; kx++) {
                        // One shift serves every output channel.
                        uint256[WORDS] memory v = shiftRow(rows, uint256(iy), int256(kx) - 1);

                        for (uint256 oc = 0; oc < outC; oc++) {
                            int256 w = kernel[oc][ky][kx];
                            if (w == 0) continue;
                            if (w > 0) {
                                uint256 m = uint256(w);
                                for (uint256 j = 0; j < WORDS; j++) pos[oc][j] += v[j] * m;
                            } else {
                                uint256 m = uint256(-w);
                                for (uint256 j = 0; j < WORDS; j++) neg[oc][j] += v[j] * m;
                            }
                        }
                    }
                }

                for (uint256 oc = 0; oc < outC; oc++) {
                    for (uint256 x = 0; x < N; x++) {
                        uint256 sh = (x % LANES) * LANE_BITS;
                        int256 p = int256((pos[oc][x / LANES] >> sh) & LANE_MASK);
                        int256 ng = int256((neg[oc][x / LANES] >> sh) & LANE_MASK);
                        int256 acc = p - ng + bias[oc];
                        if (acc > 0) checksum += uint256(acc);
                    }
                }
            }
        }
    }


    // ------------------------------------------------- conv2: 3 -> 6, 14x14

    uint256 private constant N2 = 14;
    uint256 private constant W2 = 2; // 14 lanes -> 2 words

    function conv2Naive(
        int256[][][] memory input,          // [3][14][14]
        int256[][][][] memory kernel,       // [6][3][3][3]
        int256[] memory bias
    ) public pure returns (uint256 checksum) {
        uint256 outC = kernel.length;
        uint256 inC = kernel[0].length;
        int256[][][] memory out = new int256[][][](outC);

        for (uint256 oc = 0; oc < outC; oc++) {
            out[oc] = new int256[][](N2);
            for (uint256 y = 0; y < N2; y++) {
                out[oc][y] = new int256[](N2);
                for (uint256 x = 0; x < N2; x++) {
                    int256 acc = bias[oc];
                    for (uint256 ic = 0; ic < inC; ic++) {
                        for (uint256 ky = 0; ky < 3; ky++) {
                            int256 iy = int256(y) + int256(ky) - 1;
                            if (iy < 0 || iy >= int256(N2)) continue;
                            for (uint256 kx = 0; kx < 3; kx++) {
                                int256 ix = int256(x) + int256(kx) - 1;
                                if (ix < 0 || ix >= int256(N2)) continue;
                                acc += input[ic][uint256(iy)][uint256(ix)] * kernel[oc][ic][ky][kx];
                            }
                        }
                    }
                    if (acc < 0) acc = 0;
                    out[oc][y][x] = acc;
                }
            }
        }
        unchecked {
            for (uint256 oc = 0; oc < outC; oc++)
                for (uint256 y = 0; y < N2; y++)
                    for (uint256 x = 0; x < N2; x++) checksum += uint256(out[oc][y][x]);
        }
    }

    /** Row (ic, iy) shifted by d lanes. Rows are [ic][iy] * W2 words. */
    function shiftRow2(uint256[] calldata rows, uint256 ic, uint256 iy, int256 d)
        private pure returns (uint256[W2] memory v)
    {
        uint256 base = (ic * N2 + iy) * W2;
        unchecked {
            if (d == 0) {
                for (uint256 j = 0; j < W2; j++) v[j] = rows[base + j];
            } else if (d == 1) {
                for (uint256 j = 0; j < W2; j++) {
                    uint256 hi = j + 1 < W2 ? rows[base + j + 1] : 0;
                    v[j] = (rows[base + j] >> LANE_BITS) | (hi << ((LANES - 1) * LANE_BITS));
                }
            } else {
                for (uint256 j = W2; j > 0; j--) {
                    uint256 lo = j >= 2 ? rows[base + j - 2] : 0;
                    v[j - 1] = (rows[base + j - 1] << LANE_BITS) | (lo >> ((LANES - 1) * LANE_BITS));
                }
            }
        }
    }

    function conv2Packed(
        uint256[] calldata rows,
        int256[][][][] memory kernel,
        int256[] memory bias
    ) public pure returns (uint256 checksum) {
        uint256 outC = kernel.length;
        uint256 inC = kernel[0].length;

        unchecked {
            for (uint256 y = 0; y < N2; y++) {
                uint256[W2][6] memory pos;
                uint256[W2][6] memory neg;

                for (uint256 ic = 0; ic < inC; ic++) {
                    for (uint256 ky = 0; ky < 3; ky++) {
                        int256 iy = int256(y) + int256(ky) - 1;
                        if (iy < 0 || iy >= int256(N2)) continue;
                        for (uint256 kx = 0; kx < 3; kx++) {
                            // One shift feeds all six output channels.
                            uint256[W2] memory v = shiftRow2(rows, ic, uint256(iy), int256(kx) - 1);
                            for (uint256 oc = 0; oc < outC; oc++) {
                                int256 w = kernel[oc][ic][ky][kx];
                                if (w == 0) continue;
                                if (w > 0) {
                                    uint256 m = uint256(w);
                                    for (uint256 j = 0; j < W2; j++) pos[oc][j] += v[j] * m;
                                } else {
                                    uint256 m = uint256(-w);
                                    for (uint256 j = 0; j < W2; j++) neg[oc][j] += v[j] * m;
                                }
                            }
                        }
                    }
                }

                for (uint256 oc = 0; oc < outC; oc++) {
                    for (uint256 x = 0; x < N2; x++) {
                        uint256 sh = (x % LANES) * LANE_BITS;
                        int256 p = int256((pos[oc][x / LANES] >> sh) & LANE_MASK);
                        int256 ng = int256((neg[oc][x / LANES] >> sh) & LANE_MASK);
                        int256 acc = p - ng + bias[oc];
                        if (acc > 0) checksum += uint256(acc);
                    }
                }
            }
        }
    }

    // ------------------------------------------- memory vs storage as a channel

    function writeMemory(uint256 n) public pure returns (uint256 sum) {
        uint256[] memory a = new uint256[](n);
        unchecked {
            for (uint256 i = 0; i < n; i++) a[i] = i + 1;
            for (uint256 i = 0; i < n; i++) sum += a[i];
        }
    }

    function writeStorage(uint256 n) public returns (uint256 sum) {
        unchecked {
            for (uint256 i = 0; i < n; i++) slots[i] = i + 1;
            for (uint256 i = 0; i < n; i++) sum += slots[i];
        }
    }
}
