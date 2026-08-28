// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * The same forward pass as MNISTNFT, computed on packed lanes.
 *
 * MNISTNFT gives every activation its own 256-bit word and hands every layer
 * to another contract, which costs ~59M gas -- above the per-transaction gas
 * cap of every chain measured (docs/multichain-and-parallelism.md), so a
 * prediction can only ever be an eth_call. This contract computes the identical
 * function by putting several activations in each word and multiplying all of
 * them by one broadcast weight in a single MUL, which is the data parallelism
 * the network has anyway.
 *
 * Storage layout is MNISTNFT's, slot for slot, so an already-minted model is
 * readable without re-minting: this can be deployed beside the original and
 * pointed at the same state.
 *
 * Two preconditions MNISTNFT does not have, both forced by packing:
 *   - input pixels must be non-negative (a negative lane borrows from its
 *     neighbour). MNIST pixels are 0..255.
 *   - the widest intermediate must fit a lane. The lane width is chosen at
 *     run time from the model's own weights, and a model too wide for 128-bit
 *     lanes is rejected rather than silently wrapped.
 */
contract MNISTPacked {
    // ---------------------------------------------------------------- storage
    // ERC721 (OpenZeppelin) occupies slots 0-5; these are never read here and
    // exist only to put the fields below on the slots MNISTNFT put them on.
    string private _name;
    string private _symbol;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    uint256 private _tokenIds;      // slot 6
    address private _conv2d;        // slot 7
    address private _fc;            // slot 8

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
        int256[] conv1Bias;
        int256[] conv2Bias;
        int256[] fcBias;
    }

    mapping(uint256 => ModelParams) private _tokenModelParams; // slot 9

    uint256 private constant WEIGHTS_PER_SLOT = 32;
    /// MNISTNFT calls conv2D with padding 1, stride 1, and maxPool2D with 2/2.
    uint256 private constant PADDING = 1;
    uint256 private constant POOL = 2;

    // ------------------------------------------------------------ entry point

    function inference(uint256 tokenId, int256[][] memory input28x28)
        public
        view
        returns (uint256 predictedLabel)
    {
        require(_owners[tokenId] != address(0), "Token does not exist.");
        return _argmax(logits(tokenId, input28x28));
    }

    /**
     * The pre-argmax scores. MNISTNFT only exposes the label, but the same ten
     * numbers are what its trace carries, so publishing them is what makes this
     * contract checkable against it rather than merely plausible.
     */
    function logits(uint256 tokenId, int256[][] memory input)
        public
        view
        returns (int256[] memory)
    {
        ModelParams storage mp = _tokenModelParams[tokenId];

        uint256 h = input.length;
        require(h > 0, "Input inHeight must be > 0");
        uint256 w = input[0].length;
        require(w > 0, "Input inWidth must be > 0");

        uint256[] memory w1 = _load(mp.conv1Packed);
        uint256[] memory w2 = _load(mp.conv2Packed);
        uint256[] memory wf = _load(mp.fcPacked);
        int256[] memory b1 = mp.conv1Bias;
        int256[] memory b2 = mp.conv2Bias;
        int256[] memory bf = mp.fcBias;

        uint256 laneBits = _laneBits(
            _maxPixel(input),
            [uint256(mp.conv1Out), mp.conv1In, mp.conv1K],
            [uint256(mp.conv2Out), mp.conv2In, mp.conv2K],
            w1, w2, b1, b2
        );

        // conv1 + ReLU -> pool
        Plane memory p = _pack(input, laneBits);
        p = _conv(p, w1, mp.conv1Out, mp.conv1In, mp.conv1K, b1, laneBits);
        p = _pool(p, laneBits);
        // conv2 + ReLU -> pool
        p = _conv(p, w2, mp.conv2Out, mp.conv2In, mp.conv2K, b2, laneBits);
        p = _pool(p, laneBits);

        return _fullyConnected(_flatten(p, laneBits), wf, bf, mp.fcOut, mp.fcIn);
    }

    // ----------------------------------------------------------------- planes

    /**
     * A stack of channels, each a grid of packed rows: lane x of row y of
     * channel c lives at word (c * height + y) * wordsPerRow + x / lanes.
     *
     * The hot loops below index `data` directly rather than through helpers.
     * Every accessor call was costing several hundred gas in struct loads and
     * bounds checks around three cheap opcodes -- on ~10,000 lane operations
     * that was a quarter of the whole forward pass.
     */
    struct Plane {
        uint256[] data;
        uint256 channels;
        uint256 height;
        uint256 width;
        uint256 wordsPerRow;
    }

    function _words(uint256 width, uint256 lanes) private pure returns (uint256) {
        return (width + lanes - 1) / lanes;
    }

    function _pack(int256[][] memory input, uint256 laneBits)
        private
        pure
        returns (Plane memory p)
    {
        uint256 lanes = 256 / laneBits;
        uint256 h = input.length;
        uint256 w = input[0].length;
        uint256 wpr = _words(w, lanes);
        uint256[] memory data = new uint256[](h * wpr);

        unchecked {
            for (uint256 y = 0; y < h; y++) {
                int256[] memory row = input[y];
                uint256 base = y * wpr;
                for (uint256 x = 0; x < w; x++) {
                    int256 v = row[x];
                    require(v >= 0, "input must be non-negative");
                    data[base + x / lanes] |= uint256(v) << ((x % lanes) * laneBits);
                }
            }
        }
        p = Plane(data, 1, h, w, wpr);
    }

    // ------------------------------------------------------------ convolution

    /**
     * `out[j]` holds the row's lanes starting `d` further along, so lane x
     * carries the value at x + d. Lanes from outside the row come back zero,
     * which is exactly the zero padding conv2D does.
     */
    function _shift(
        uint256[] memory out,
        uint256[] memory data,
        uint256 base,
        uint256 wordsPerRow,
        int256 d,
        uint256 laneBits,
        uint256 lanes
    ) private pure {
        uint256 n = out.length;
        unchecked {
            if (d == 0) {
                for (uint256 j = 0; j < n; j++) out[j] = j < wordsPerRow ? data[base + j] : 0;
                return;
            }
            uint256 mag = d > 0 ? uint256(d) : uint256(-d);
            uint256 wordOffset = mag / lanes;
            uint256 bitOffset = (mag % lanes) * laneBits;

            for (uint256 j = 0; j < n; j++) {
                int256 k = d > 0 ? int256(j + wordOffset) : int256(j) - int256(wordOffset);
                uint256 lo = (k >= 0 && uint256(k) < wordsPerRow) ? data[base + uint256(k)] : 0;
                if (bitOffset == 0) {
                    out[j] = lo;
                } else if (d > 0) {
                    int256 n2 = k + 1;
                    uint256 hi = (n2 >= 0 && uint256(n2) < wordsPerRow) ? data[base + uint256(n2)] : 0;
                    out[j] = (lo >> bitOffset) | (hi << (256 - bitOffset));
                } else {
                    int256 n2 = k - 1;
                    uint256 hi = (n2 >= 0 && uint256(n2) < wordsPerRow) ? data[base + uint256(n2)] : 0;
                    out[j] = (lo << bitOffset) | (hi >> (256 - bitOffset));
                }
            }
        }
    }

    function _w(uint256[] memory words, uint256 i) private pure returns (int256) {
        unchecked {
            return int256(int8(uint8(words[i / WEIGHTS_PER_SLOT] >> ((i % WEIGHTS_PER_SLOT) * 8))));
        }
    }

    /**
     * Convolution with ReLU folded in.
     *
     * Positive and negative weights accumulate into two non-negative running
     * sums, because a lane that went negative would borrow from its neighbour;
     * the subtraction happens once per output value, outside the lanes.
     *
     * The arithmetic is unchecked because `_laneBits` has already proved, from
     * the model's own weights, that no accumulator can reach 2^laneBits -- the
     * same fact that makes the lanes independent makes the words safe.
     */
    function _conv(
        Plane memory src,
        uint256[] memory kernel,
        uint256 outC,
        uint256 inC,
        uint256 k,
        int256[] memory bias,
        uint256 laneBits
    ) private pure returns (Plane memory dst) {
        require(inC == src.channels, "Kernel inChannels mismatch");
        require(bias.length == outC, "Bias length mismatch");

        uint256 lanes = 256 / laneBits;
        uint256 mask = (uint256(1) << laneBits) - 1;
        uint256 srcH = src.height;
        uint256 srcWpr = src.wordsPerRow;
        uint256[] memory srcData = src.data;

        uint256 outH = srcH + 2 * PADDING - k + 1;
        uint256 outW = src.width + 2 * PADDING - k + 1;
        uint256 wpr = _words(outW, lanes);
        uint256[] memory data = new uint256[](outC * outH * wpr);

        uint256[] memory pos = new uint256[](outC * wpr);
        uint256[] memory neg = new uint256[](outC * wpr);
        uint256[] memory shifted = new uint256[](wpr);

        unchecked {
            for (uint256 oy = 0; oy < outH; oy++) {
                for (uint256 i = pos.length; i > 0; i--) {
                    pos[i - 1] = 0;
                    neg[i - 1] = 0;
                }

                for (uint256 ic = 0; ic < inC; ic++) {
                    for (uint256 ky = 0; ky < k; ky++) {
                        int256 iy = int256(oy + ky) - int256(PADDING);
                        if (iy < 0 || uint256(iy) >= srcH) continue;
                        uint256 base = (ic * srcH + uint256(iy)) * srcWpr;

                        for (uint256 kx = 0; kx < k; kx++) {
                            // One shift feeds every output channel.
                            _shift(shifted, srcData, base, srcWpr,
                                   int256(kx) - int256(PADDING), laneBits, lanes);

                            uint256 wBase = (ic * k + ky) * k + kx;
                            for (uint256 oc = 0; oc < outC; oc++) {
                                int256 weight = _w(kernel, oc * inC * k * k + wBase);
                                if (weight == 0) continue;
                                uint256 m = uint256(weight > 0 ? weight : -weight);
                                uint256[] memory acc = weight > 0 ? pos : neg;
                                uint256 off = oc * wpr;
                                for (uint256 j = 0; j < wpr; j++) acc[off + j] += shifted[j] * m;
                            }
                        }
                    }
                }

                for (uint256 oc = 0; oc < outC; oc++) {
                    uint256 off = oc * wpr;
                    uint256 dstBase = (oc * outH + oy) * wpr;
                    int256 b = bias[oc];
                    for (uint256 ox = 0; ox < outW; ox++) {
                        uint256 word = ox / lanes;
                        uint256 sh = (ox % lanes) * laneBits;
                        int256 v = int256((pos[off + word] >> sh) & mask)
                            - int256((neg[off + word] >> sh) & mask)
                            + b;
                        if (v > 0) data[dstBase + word] |= uint256(v) << sh;
                    }
                }
            }
        }

        dst = Plane(data, outC, outH, outW, wpr);
    }

    // ------------------------------------------------------------------ pool

    function _pool(Plane memory src, uint256 laneBits) private pure returns (Plane memory dst) {
        uint256 lanes = 256 / laneBits;
        uint256 mask = (uint256(1) << laneBits) - 1;
        uint256 srcH = src.height;
        uint256 srcWpr = src.wordsPerRow;
        uint256[] memory srcData = src.data;

        uint256 outH = (srcH - POOL) / POOL + 1;
        uint256 outW = (src.width - POOL) / POOL + 1;
        uint256 wpr = _words(outW, lanes);
        uint256[] memory data = new uint256[](src.channels * outH * wpr);

        unchecked {
            for (uint256 c = 0; c < src.channels; c++) {
                for (uint256 oy = 0; oy < outH; oy++) {
                    uint256 dstBase = (c * outH + oy) * wpr;
                    for (uint256 ox = 0; ox < outW; ox++) {
                        uint256 best;
                        for (uint256 dy = 0; dy < POOL; dy++) {
                            uint256 row = (c * srcH + oy * POOL + dy) * srcWpr;
                            for (uint256 dx = 0; dx < POOL; dx++) {
                                uint256 x = ox * POOL + dx;
                                uint256 v = (srcData[row + x / lanes] >> ((x % lanes) * laneBits)) & mask;
                                if (v > best) best = v;
                            }
                        }
                        // Activations are post-ReLU, so the window's maximum is
                        // never negative and zero needs no write.
                        if (best != 0) data[dstBase + ox / lanes] |= best << ((ox % lanes) * laneBits);
                    }
                }
            }
        }

        dst = Plane(data, src.channels, outH, outW, wpr);
    }

    function _flatten(Plane memory p, uint256 laneBits) private pure returns (int256[] memory flat) {
        uint256 lanes = 256 / laneBits;
        uint256 mask = (uint256(1) << laneBits) - 1;
        uint256[] memory data = p.data;
        uint256 h = p.height;
        uint256 w = p.width;
        uint256 wpr = p.wordsPerRow;
        flat = new int256[](p.channels * h * w);

        unchecked {
            uint256 i;
            for (uint256 c = 0; c < p.channels; c++) {
                for (uint256 y = 0; y < h; y++) {
                    uint256 base = (c * h + y) * wpr;
                    for (uint256 x = 0; x < w; x++) {
                        flat[i++] = int256((data[base + x / lanes] >> ((x % lanes) * laneBits)) & mask);
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------------- fc

    /**
     * Scalar on purpose. It is 2,940 multiply-accumulates against ~53,000 in
     * the convolutions, and its accumulator carries the scale of every layer
     * before it -- around 1e13 here -- so packing it would force lanes wide
     * enough to shrink the convolutions' width for no useful gain.
     */
    function _fullyConnected(
        int256[] memory input,
        uint256[] memory weights,
        int256[] memory bias,
        uint256 outSize,
        uint256 inSize
    ) private pure returns (int256[] memory out) {
        require(input.length == inSize, "Weight row size mismatch with input size.");
        require(bias.length == outSize, "Weights and bias size mismatch.");
        out = new int256[](outSize);
        unchecked {
            for (uint256 j = 0; j < outSize; j++) {
                int256 sum = bias[j];
                uint256 row = j * inSize;
                for (uint256 i = 0; i < inSize; i++) {
                    int256 v = input[i];
                    // Post-ReLU activations are mostly zero; skipping them is
                    // worth more here than anywhere else in the network.
                    if (v != 0) sum += v * _w(weights, row + i);
                }
                out[j] = sum;
            }
        }
    }

    function _argmax(int256[] memory data) private pure returns (uint256 idx) {
        require(data.length > 0, "Data array cannot be empty.");
        int256 best = data[0];
        unchecked {
            for (uint256 i = 1; i < data.length; i++) {
                if (data[i] > best) {
                    best = data[i];
                    idx = i;
                }
            }
        }
    }

    // -------------------------------------------------------------- lane width

    function _load(uint256[] storage words) private view returns (uint256[] memory out) {
        uint256 n = words.length;
        out = new uint256[](n);
        unchecked {
            for (uint256 i = 0; i < n; i++) out[i] = words[i];
        }
    }

    function _maxPixel(int256[][] memory input) private pure returns (uint256 max) {
        unchecked {
            for (uint256 y = 0; y < input.length; y++) {
                int256[] memory row = input[y];
                for (uint256 x = 0; x < row.length; x++) {
                    int256 v = row[x];
                    require(v >= 0, "input must be non-negative");
                    if (uint256(v) > max) max = uint256(v);
                }
            }
        }
    }

    /// Largest sum of |weight| over one output channel: the gain of the layer.
    function _gain(uint256[] memory kernel, uint256 outC, uint256 perOut)
        private
        pure
        returns (uint256 max)
    {
        unchecked {
            for (uint256 oc = 0; oc < outC; oc++) {
                uint256 sum;
                for (uint256 i = 0; i < perOut; i++) {
                    int256 v = _w(kernel, oc * perOut + i);
                    sum += uint256(v >= 0 ? v : -v);
                }
                if (sum > max) max = sum;
            }
        }
    }

    function _maxAbs(int256[] memory values) private pure returns (uint256 max) {
        for (uint256 i = 0; i < values.length; i++) {
            uint256 v = uint256(values[i] >= 0 ? values[i] : -values[i]);
            if (v > max) max = v;
        }
    }

    /**
     * The narrowest lane this model cannot overflow.
     *
     * Bounding it from the weights rather than assuming a width is what keeps
     * this safe for a model nobody has minted yet: the widest value any lane
     * can hold is the input's peak multiplied by each layer's gain, and a model
     * that needs more than 128 bits is refused instead of wrapping silently.
     */
    function _laneBits(
        uint256 peak,
        uint256[3] memory shape1,
        uint256[3] memory shape2,
        uint256[] memory w1,
        uint256[] memory w2,
        int256[] memory b1,
        int256[] memory b2
    ) private pure returns (uint256) {
        uint256 acc1 = peak * _gain(w1, shape1[0], shape1[1] * shape1[2] * shape1[2]);
        uint256 act1 = acc1 + _maxAbs(b1);
        uint256 acc2 = act1 * _gain(w2, shape2[0], shape2[1] * shape2[2] * shape2[2]);
        uint256 act2 = acc2 + _maxAbs(b2);

        uint256 widest = peak;
        if (acc1 > widest) widest = acc1;
        if (act1 > widest) widest = act1;
        if (acc2 > widest) widest = acc2;
        if (act2 > widest) widest = act2;

        if (widest < (uint256(1) << 32)) return 32;
        if (widest < (uint256(1) << 64)) return 64;
        if (widest < (uint256(1) << 128)) return 128;
        revert("model too wide to pack");
    }
}
