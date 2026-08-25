"""Bit-exact Python replica of the on-chain inference math.

Mirrors Convolution2D.sol, FullyConnectedLayer.sol and MNISTNFT.inference()
using pure integer arithmetic, so quantized accuracy can be measured offline
instead of paying for an eth_call per image.

The contracts perform NO rescaling between layers: every layer is a raw
integer accumulate. That means the implicit scale factor multiplies through
the network, and each layer's bias must be pre-scaled to match the scale of
the products it is added to. See quantize() in train.py.
"""

import numpy as np

# int256 in the contracts; int64 in numpy. Assert we stay well inside int64 so
# the numpy math is exact rather than silently wrapping.
_INT64_GUARD = 1 << 62


def _guard(name, max_operand_a, max_operand_b, n_terms, max_bias):
    """Pre-check that a sum-of-products cannot overflow int64.

    Checked BEFORE the operation, not after: numpy wraps silently on overflow,
    so inspecting the result would report a small max for a value that already
    wrapped. The contracts use int256 and never overflow; this guard only
    protects the numpy replica.
    """
    bound = int(max_operand_a) * int(max_operand_b) * int(n_terms) + int(max_bias)
    if bound >= _INT64_GUARD:
        raise OverflowError(
            f"{name} could reach {bound:.3e}, beyond the int64 replica's range; "
            f"lower SCALE in train.py"
        )


def conv2d(input_data, kernel, bias, padding, stride):
    """Convolution2D.conv2D - [IC][H][W], [OC][IC][K][K], [OC] -> [OC][OH][OW]"""
    in_c, in_h, in_w = input_data.shape
    out_c, k_ic, k_size, _ = kernel.shape
    assert k_ic == in_c, f"channel mismatch: kernel expects {k_ic}, got {in_c}"
    assert bias.shape[0] == out_c, "Bias length mismatch"

    out_h = (in_h + 2 * padding - k_size) // stride + 1
    out_w = (in_w + 2 * padding - k_size) // stride + 1

    _guard("conv2d", np.abs(input_data).max(initial=0), np.abs(kernel).max(initial=0),
           in_c * k_size * k_size, np.abs(bias).max(initial=0))

    # Zero padding, matching the contract's `curH/curW in range` guard.
    padded = np.zeros((in_c, in_h + 2 * padding, in_w + 2 * padding), dtype=np.int64)
    padded[:, padding:padding + in_h, padding:padding + in_w] = input_data

    out = np.zeros((out_c, out_h, out_w), dtype=np.int64)
    for oc in range(out_c):
        acc = np.zeros((out_h, out_w), dtype=np.int64)
        for ic in range(in_c):
            for kh in range(k_size):
                for kw in range(k_size):
                    window = padded[
                        ic,
                        kh:kh + out_h * stride:stride,
                        kw:kw + out_w * stride:stride,
                    ]
                    acc += window * kernel[oc, ic, kh, kw]
        out[oc] = acc + bias[oc]
    return out


def max_pool2d(input_data, pool_size, pool_stride):
    """Convolution2D.maxPool2D"""
    in_c, in_h, in_w = input_data.shape
    out_h = (in_h - pool_size) // pool_stride + 1
    out_w = (in_w - pool_size) // pool_stride + 1

    out = np.full((in_c, out_h, out_w), np.iinfo(np.int64).min, dtype=np.int64)
    for kh in range(pool_size):
        for kw in range(pool_size):
            window = input_data[
                :,
                kh:kh + out_h * pool_stride:pool_stride,
                kw:kw + out_w * pool_stride:pool_stride,
            ]
            out = np.maximum(out, window)
    return out


def flatten3d(input_data):
    """Convolution2D.flatten3D - channel-major, matching the nested loop order."""
    return input_data.reshape(-1)


def relu(x):
    """FullyConnectedLayer.relu applied elementwise (MNISTNFT.relu3D)."""
    return np.maximum(x, 0)


def fully_connected(input_vec, weights, bias):
    """FullyConnectedLayer.fullyConnected - weights is [OUT][IN]."""
    assert weights.shape[1] == input_vec.shape[0], "Weight row size mismatch with input size."
    assert weights.shape[0] == bias.shape[0], "Weights and bias size mismatch."

    _guard("fc", np.abs(input_vec).max(initial=0), np.abs(weights).max(initial=0),
           weights.shape[1], np.abs(bias).max(initial=0))
    return weights @ input_vec + bias


def argmax(data):
    """FullyConnectedLayer.argmax - strict >, so ties resolve to the lowest index."""
    return int(np.argmax(data))


def inference(input28x28, params):
    """MNISTNFT.inference - the full forward pass, integers end to end.

    input28x28: 28x28 integer array (0-255, as the frontend canvas produces)
    params: dict of int arrays with keys conv1, conv1_bias, conv2, conv2_bias,
            fc, fc_bias -- exactly the JSON that gets minted into the NFT.
    """
    x = np.asarray(input28x28, dtype=np.int64).reshape(1, 28, 28)

    x = conv2d(x, params["conv1"], params["conv1_bias"], padding=1, stride=1)
    x = relu(x)
    x = max_pool2d(x, 2, 2)

    x = conv2d(x, params["conv2"], params["conv2_bias"], padding=1, stride=1)
    x = relu(x)
    x = max_pool2d(x, 2, 2)

    x = flatten3d(x)
    x = fully_connected(x, params["fc"], params["fc_bias"])
    return argmax(x)


def load_params(path):
    """Load a minted-params JSON into int64 numpy arrays."""
    import json

    with open(path) as f:
        raw = json.load(f)
    return {k: np.array(v, dtype=np.int64) for k, v in raw.items()}
