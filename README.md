# On-Chain Handwritten Digit Recognition

A small convolutional network whose weights live inside an NFT and whose entire
forward pass — every multiply-accumulate, ReLU, max-pool and argmax — executes
in EVM contracts on Monad testnet. Nothing is computed off-chain.

Inference is a `view` call, so the demo needs no wallet, no gas and no signature.

## Contracts (Monad testnet, chainId 10143)

| Contract | Address |
| --- | --- |
| `Convolution2D` | `0x00a8d614722c5f7325d00e689ec3eb71046c424f` |
| `FullyConnectedLayer` | `0xaa8a00158b72f28a324634265dbb060e67b1259d` |
| `MNISTNFT` | `0x4420fe892e106939aed7165dbca4a5caa65e8647` |

Model NFT: token `1`.

> Monad's testnet was re-genesised on 2025-12-16, which wiped every contract
> deployed before that date. If the app reports "no contract code", the testnet
> was likely reset again — redeploy and update `.env`.

## Run locally

Requires Node ≥ 20.

```
cp .env.example .env
npm install
npm run dev
```

`npm run dev` always talks to Monad testnet. To run the whole demo locally,
deploy to anvil (see Workflow below), write a `.env.anvil`:

```
NEXT_PUBLIC_MONADTESTNET_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_MONADTESTNET_CONTRACT_ADDRESS=<MNISTNFT from deployments.anvil.json>
```

and start with `npm run dev:anvil`. The file is deliberately not called
`.env.local`, which Next.js would load ahead of `.env` and silently repoint
every run at a local node.

anvil serves `debug_traceCall` and `prestateTracer` too, so the execution view
works unchanged. The app labels the network from the chain id the node reports,
so it will say `Anvil (local)` rather than pretending to be testnet.

## Quantization

The contracts do **no rescaling between layers** — each layer is a raw integer
accumulate — so scale factors multiply through the network:

```
input    X_int = X_real * 255          (canvas sends 0-255)
conv1    scale = 255 * s1
conv2    scale = 255 * s1 * s2
fc       scale = 255 * s1 * s2 * s3
```

Weights are per-tensor symmetric **int8** (`s = 127 / max|W|`). Each bias must be
pre-scaled to the accumulated scale of the products it is added to; scaling every
bias by a single factor — as the original code did — silently drops the conv2 and
fc biases entirely.

Because nothing is requantized between layers, activations stay full-width
`int256` and grow to ~1e13 by the fc output. This is int8 *weights*, not int8
*arithmetic*: on the EVM every value occupies a 256-bit word and arithmetic costs
the same regardless of magnitude, so quantizing the activations would add work
rather than save it. int8 is used where it does pay — storage.

Weights are packed 32-to-a-word, and the packing happens **client-side** —
`mint` takes `uint256[]` of packed words, not `int[]` of weights. Both halves of
that matter:

| | int256 per slot | packed on-chain | packed client-side |
| --- | ---: | ---: | ---: |
| storage slots | ~3,149 | ~117 | ~117 |
| mint calldata | ~108 KB | ~108 KB | 4.4 KB |
| mint gas | ~74M | ~6.9M | 2.79M |

Sending the weights as `int[]` spends a full 32-byte word on every int8. That is
~1.7M gas of calldata, and — the reason it is not merely wasteful — it exceeds
MetaMask's JSON-RPC request size limit, so minting from a browser wallet fails
with `Request too large` before the transaction reaches the chain.

The int8 range check moves off-chain with the packing; `mint` still validates
that the word count and bias lengths match the declared shapes, so a mis-shaped
upload cannot be stored. `lib/pack.ts` is shared by `scripts/mint.ts` and the
browser, and `scripts/verify.ts` is what proves the packed layout matches what
the contract reads back.

Measured on the full MNIST test set: float 98.09%, int8 98.13%.

## Workflow

```bash
# train, quantize, and write the params JSON
python3 model/train.py

# build a verification fixture (images + the simulator's predictions)
python3 model/make_fixture.py model/checkpoints/<best>.pth 200

# compile
cd model/scripts_for_contracts_and_test && forge build && cd -

# local chain
anvil --gas-limit 2000000000 --block-base-fee-per-gas 0

npx tsx scripts/deploy.ts --target anvil
npx tsx scripts/mint.ts   --target anvil --params model/checkpoints/<best>.json
npx tsx scripts/verify.ts --target anvil

# testnet (Convolution2D and FullyConnectedLayer are stateless and reusable)
npx tsx scripts/deploy.ts --target monadTestnet --conv 0x00a8… --fc 0xaa8a…
npx tsx scripts/mint.ts   --target monadTestnet --params model/checkpoints/<best>.json
npx tsx scripts/verify.ts --target monadTestnet
```

`model/solidity_sim.py` is a numpy replica of the contract arithmetic, used as a
fast inner loop during training. It is only trusted where `scripts/verify.ts`
shows it agreeing with real bytecode — currently 200/200 on both anvil and
testnet. If they ever disagree, the chain is authoritative.

## Execution trace

Predicting is **one** `debug_traceCall` (`lib/trace.ts`). The root call's own
return value is the prediction, and because `inference` delegates every layer to
`Convolution2D` / `FullyConnectedLayer` via external calls, the same callTracer
output already contains each layer's actual return data. Asking for the answer
with a separate `eth_call` and then tracing it would make the node run the same
~50M gas of work twice for one click.

The trace is ~2 MB / 3,535 calls, so the prediction costs ~1s on testnet rather
than the ~330ms a bare `eth_call` takes. That is the price of showing the work,
paid once. If the RPC has no `debug` namespace, the app falls back to a plain
call: the prediction still works, only the visualization is missing.

Two views are built from that one trace:

- `components/InferenceTrace.tsx` — the activations, layer by layer. Measured,
  not recomputed in the browser.
- `components/ChainExecution.tsx` — the chain-level view: which contract holds
  execution at each moment and what each call cost. The call sequence is drawn
  twice, once with gas on the x axis and once with call index, because the two
  are nothing alike — `relu` is 99.8% of the calls and 1.5% of the gas.

Two things there are opt-in, because each costs another execution:

- **storage** — `prestateTracer` reports the 128 words the inference reads out of
  `MNISTNFT`, where the packed int8 weights live. Cached after the first read:
  the weights do not depend on the image.
- **per-layer wall-clock** — each layer re-issued as its own `eth_call` with the
  calldata the trace recorded. The math contracts are pure, so the replay returns
  byte-identical output. Each figure includes one RPC round trip and excludes the
  per-element `relu` calls, so they do not decompose the combined call's latency.

Execution is replayed, not streamed. Neither Monad nor any other EVM chain
exposes intra-call progress — a call either returns or reverts — so the play
head walks the recorded trace of the call that already ran, over exactly the
wall-clock the call itself took. Within that window it advances by **gas**: a
trace records what each call cost, never when it ran.

Measured gas breakdown of one forward pass (Monad testnet):

| Callee | Calls | Gas | Share |
| --- | ---: | ---: | ---: |
| `conv2D` | 2 | 45.57M | 89.6% |
| `maxPool2D` | 2 | 2.65M | 5.2% |
| `fullyConnected` | 1 | 1.67M | 3.3% |
| `relu` | 3,528 | 0.75M | 1.5% |
| `flatten3D` | 1 | 0.19M | 0.4% |

That is ~860 gas per multiply-accumulate against 8 gas of actual arithmetic —
the cost is nested-memory-array indexing and ABI round-trips, not the maths.
The 3,528 `relu` cross-contract calls, which look like the obvious problem, are
1.5% of the total. See [docs/onchain-training-research.md](docs/onchain-training-research.md).

## Notes on Monad

- Fees are charged on the declared **gas limit**, not gas used, so padding a gas
  limit costs real money. Base fee has been a flat 100 gwei.
- There is a per-transaction gas cap below the 150M block limit; a ~65M-gas
  transaction is rejected with `Exceeds transaction gas limit`.
- `eth_call` allowances are far larger (200M on the public RPC), which is what
  makes a ~60M-gas `inference` view call viable.
- `debug_traceCall` reports the **supplied** gas as the root call's `gasUsed`,
  not the gas consumed — supply 100M and it answers 100M. anvil reports the real
  figure. The UI treats anything at or above the limit as unknown and sums the
  external calls instead.
- `debug_traceCall` and `prestateTracer` both work on the public RPC; `trace_*`
  is not exposed.
- MetaMask caps JSON-RPC request size. It is not a chain limit, but it decides
  what a browser wallet can send: 108 KB of mint calldata is rejected with
  `Request too large` before it reaches the node.
- wagmi's default Multicall3 batching must stay **off** (`batch: { multicall:
  false }`). Routed through Multicall3, the 63/64 gas-forwarding rule starves
  `inference`, and `aggregate3` swallows the failure into a bare revert.

## Schematic

![schematic](public/schematic.png)

## Net backbone

![netBackBone](public/backbone.png)
