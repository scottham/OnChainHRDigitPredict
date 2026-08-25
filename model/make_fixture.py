"""Build a verification fixture: MNIST images plus the simulator's predictions.

The on-chain result must match simPredictions EXACTLY -- that is the check that
solidity_sim.py is a faithful replica of the contracts. `labels` is the actual
ground truth, used to report real accuracy.

Usage:
    python3 model/make_fixture.py <checkpoint.pth> [n_images] [out.json]
"""

import json
import sys

import numpy as np
import torch
import torchvision
import torchvision.transforms as transforms

import solidity_sim
from train import MNISTNet, quantize


def main():
    ckpt = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    out = sys.argv[3] if len(sys.argv) > 3 else "fixtures/verify.json"

    model = MNISTNet()
    model.load_state_dict(torch.load(ckpt))
    model.eval()
    params = quantize(model)

    ds = torchvision.datasets.MNIST(
        root="./model/data", train=False, transform=transforms.ToTensor()
    )
    images = ds.data.numpy().astype(np.int64)
    labels = ds.targets.numpy().astype(np.int64)

    # Stratified sample so every digit is represented evenly.
    rng = np.random.default_rng(42)
    per_digit = max(1, n // 10)
    idx = np.concatenate(
        [rng.choice(np.where(labels == d)[0], per_digit, replace=False) for d in range(10)]
    )
    rng.shuffle(idx)

    predictions = [int(solidity_sim.inference(images[k], params)) for k in idx]
    correct = sum(int(p == labels[k]) for p, k in zip(predictions, idx))

    fixture = {
        "note": "chain output must equal simPredictions exactly; labels are ground truth",
        "checkpoint": ckpt,
        "indices": idx.tolist(),
        "images": [images[k].tolist() for k in idx],
        "labels": [int(labels[k]) for k in idx],
        "simPredictions": predictions,
    }
    with open(out, "w") as f:
        json.dump(fixture, f)

    print(f"wrote {out}: {len(idx)} images, {per_digit} per digit")
    print(f"simulator accuracy on this sample: {correct}/{len(idx)} ({100 * correct / len(idx):.1f}%)")


if __name__ == "__main__":
    main()
