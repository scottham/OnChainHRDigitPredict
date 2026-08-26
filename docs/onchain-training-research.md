# On-Chain Training: What Is Actually Possible

Research notes, August 2026. Written against this repo, which runs a real
convolutional network's forward pass entirely inside EVM contracts on Monad
testnet — so the numbers here are measured, not estimated from a whitepaper.

---

## Bottom line

Nobody trains neural networks on-chain, and the gap is not close enough to be
worth closing. Every system that markets itself as "on-chain learning" does the
gradient computation somewhere else — an L2, an off-chain worker, a prover — and
uses the chain for storage, aggregation, verification, or payment.

Using this project's own measured forward pass, training its ~3,150-parameter
MNIST model on-chain for 30 epochs would cost **2.7 × 10¹⁴ gas ≈ 27 million
MON**, and would consume **every block on Monad testnet for 8.5 days straight**.
That is for a model small enough to be a homework exercise. The barrier is four
to six orders of magnitude, not a factor of two.

What *is* real: on-chain inference for small models, on-chain aggregation of
off-chain gradients, and verified inference via zk or optimistic proofs.

---

## 1. What "on-chain training" is usually being claimed

The phrase is used for four quite different things. Only the first is literal.

| Claim | Where gradients are computed | Real today? |
| --- | --- | --- |
| Backprop inside a contract | EVM | No |
| On-chain aggregation of off-chain gradients (federated learning) | Clients | Yes |
| Training on L2, inference/params on L1 | L2 rollup | Yes |
| Verified inference (zkML / opML) | Off-chain prover | Yes — but this is *inference*, not training |

Most "decentralized AI training" projects are the second or third row. The
[AFT 2025 paper on on-chain decentralized learning](https://arxiv.org/pdf/2510.16024)
is explicit about this: it calls itself "the first decentralized, fully on-chain
learning framework", and its own architecture description is
"all model training and governance occur on Layer-2 (L2), while inference is
optimized and happens on Layer-1 (L1) under strict gas constraints." Even the
state-of-the-art paper claiming full on-chain learning does not run backprop on
the settlement layer.

---

## 2. Why backprop is hard on the EVM

### 2.1 It is not the arithmetic — it is the memory addressing

This is the most useful thing measured here, and it contradicts the usual
explanation.

The intuition is that on-chain ML is expensive because multiplication is
expensive, or because there are no floats. Neither dominates. Tracing a real
inference call on Monad testnet with `debug_traceCall` gives this breakdown:

| Callee | Calls | Gas | Share | Avg per call |
| --- | ---: | ---: | ---: | ---: |
| `conv2D` | 2 | 45.57M | **89.6%** | 22,785,174 |
| `maxPool2D` | 2 | 2.65M | 5.2% | 1,324,549 |
| `fullyConnected` | 1 | 1.67M | 3.3% | 1,673,810 |
| `relu` | 3,528 | 0.75M | 1.5% | 212 |
| `flatten3D` | 1 | 0.19M | 0.4% | 190,291 |
| `argmax` | 1 | 0.003M | 0.0% | 2,706 |
| **total** | **3,535** | **50.84M** | | |

The two convolutions perform roughly 53,000 multiply-accumulates
(conv1: 3·28·28·9 = 21,168; conv2: 6·14·14·3·9 = 31,752) for 45.57M gas —
about **860 gas per MAC**.

The arithmetic in a MAC is `MUL` (5 gas) + `ADD` (3 gas) = **8 gas**. So
**99% of the cost is everything around the multiply**: indexing nested dynamic
memory arrays (`inputData[ic][ih][iw]` is three pointer loads with three bounds
checks), ABI-decoding `int256[][][]` arguments across the contract boundary, and
memory expansion for intermediate feature maps.

Two consequences follow, and both matter for training:

- Optimizing the *math* (fewer bits, cheaper ops) buys almost nothing. This
  repo already learned that the hard way: quantizing weights to int8 cut
  *storage* cost 10× but would not have touched the 90% spent in `conv2D`.
- Backpropagation touches *more* memory than the forward pass, not less. It
  needs the saved activations of every layer plus a gradient tensor per layer.
  On the EVM that is the expensive axis.

Note also that the 3,528 `relu` external calls — the thing that looks most
alarming in the source — cost 212 gas each and total 1.5%. Cross-contract calls
to a warm address are cheap. This is worth stating because it is a natural thing
to assume and it is wrong.

### 2.2 No floating point

The EVM has integers only. Every implementation must pick a fixed-point or
quantized scheme, and that decision is load-bearing in a way it is not off-chain.
For *inference* this is a solved annoyance — this repo uses per-tensor int8
weights with the scale accumulating through the layers, and matches float
accuracy exactly (98.13% int8 vs 98.09% float on the full MNIST test set).

For *training* it is much worse:

- Gradients have far larger dynamic range than activations. int8 gradients do
  not work; you need wide accumulators and careful loss scaling.
- The learning rate multiplication `w -= lr * grad` needs division, and integer
  division truncates toward zero. With a small learning rate, most updates round
  to zero and the model simply stops learning. Avoiding this requires
  maintaining fixed-point residuals per parameter — more state, more storage.
- Optimizers with state (Adam keeps two extra values per parameter) triple the
  parameter storage that must be written every step.

### 2.3 Storage writes

Weight updates are `SSTORE`s, and `SSTORE` is the most expensive common opcode
(2,900 gas to modify a warm non-zero slot; 20,000 for a fresh one). Every
training step rewrites every parameter.

This repo packs weights 32-to-a-slot as int8, which is what makes minting a
model a single 6.9M-gas transaction instead of ~74M. But packing helps only
because the values are written once. During training, a packed slot must be
read, unpacked, updated, repacked and written for *every* parameter in it —
and gradient accumulators cannot be int8 anyway.

### 2.4 The per-transaction ceiling

Monad rejects a transaction with a ~65M gas limit outright
(`Exceeds transaction gas limit`), below its 150M block gas limit. Ethereum's
block limit is ~30M. So a training step cannot be one transaction; it has to be
chunked across many, with intermediate state persisted to storage between them —
which multiplies the storage cost again.

The AFT paper hits the same wall from the other side: it reports the ML2SC
baseline's deployment at **73,721,648 gas**, noting this is "nearly twice
Ethereum's current block gas limit."

---

## 3. What a training step would actually cost here

Grounded entirely in this repo's measured 50.84M-gas forward pass.

Backpropagation through a conv layer requires two convolutions of comparable
size to the forward one: `dL/dW` (correlate input with output gradient) and
`dL/dX` (full convolution of output gradient with the flipped kernel). So a
full step is roughly **3× the forward pass**, before counting the optimizer and
the extra storage traffic — this is a floor, not a forecast.

| Unit | Gas | Cost @100 gwei | Full 150M blocks |
| --- | ---: | ---: | ---: |
| 1 forward pass (measured) | 50.8M | 5.1 MON | 0.34 |
| 1 training step, 1 sample | ~153M | 15.3 MON | 1.0 |
| 1 batch of 64 | ~9.8B | 976 MON | 65 |
| 1 epoch (60k samples) | ~9.2T | 915,120 MON | 61,008 |
| 30 epochs | **2.7 × 10¹⁴** | **27,453,600 MON** | 1.8M |

At Monad's 150M gas per 400ms block — 375M gas/second of total chain capacity —
the full run needs **732,096 seconds ≈ 8.5 days** during which the chain does
nothing but train this one model.

For scale: the model is 3,149 parameters. GPT-2 small is 124 million. The ratio
is ~39,000×, and training cost scales worse than linearly once you account for
the memory traffic that already dominates here.

---

## 4. Where the real work is happening

### Inference on-chain (works, for small models)

The [AFT 2025 paper](https://arxiv.org/pdf/2510.16024) reports L1 inference at
57,603 gas for logistic regression, 143,647 gas for a small CNN, up to 969k gas
for CNN(F16,K4) and 1.13M for an RNN. Their framework's total setup is 1.17M gas
versus ~12.0M for the [ML2SC](https://arxiv.org/pdf/2404.16967) baseline.

This project's 50.8M-gas inference is 50–350× more expensive than those, because
the model is larger (two conv layers over a full 28×28 image rather than a
handful of engineered features) and because it passes full `int256[][][]` tensors
across contract boundaries. That gap is the memory-addressing cost from §2.1, and
it is the thing to attack if this project ever wants cheaper inference — fusing
the layers into one contract to avoid ABI round-trips would plausibly remove a
large fraction of the 90%.

### Federated learning with on-chain aggregation (works)

The common real architecture: clients train locally, submit updates, and a
contract aggregates them. [J.P. Morgan's work](https://www.jpmorgan.com/content/dam/jpm/cib/complex/content/technology/publications/publication-smartcontracts.pdf)
and the survey literature agree that aggregation itself is often too expensive
to do fully on-chain in public settings, so production designs push it off-chain
with hash-pointer commitments and keep only reputation/consensus state on-chain.
See also [verifiable off-chain computation for blockchain FL](https://arxiv.org/pdf/2206.11641)
and [SoK: Verifiable Federated Learning](https://eprint.iacr.org/2025/2296.pdf).

The chain's role here is coordination and Sybil-resistance, not computation.

### zkML / opML (works, for verified inference)

This is the most active area, and it is worth being precise: **it verifies
inference, it does not train.**

- [EZKL](https://blog.icme.io/the-definitive-guide-to-zkml-2025/) reached 1.0
  supporting ONNX models up to ~50M parameters, and can prove an MNIST-sized
  classification in under a second in <180 MB.
- Modulus Labs' *The Cost of Intelligence* demonstrated verification of models
  up to ~18M parameters, with RockyBot and *Leela vs. the World* as live demos.
- Giza targets StarkNet/Cairo.
- [zk-OPML](https://github.com/Vid201/zk-OPML)
  ([paper](https://link.springer.com/article/10.1007/s44443-026-00573-1))
  hybridizes optimistic verification with ZKPs, trading opML's long dispute
  windows against zkML's proving cost.

Proving overhead has improved roughly 1,000,000× → 100,000× → 10,000× across
recent years — genuine progress, but still four orders of magnitude. And proving
a *training run* means proving every step of it, so zkML makes training strictly
more expensive than doing it plainly, not less.

---

## 5. Does Monad change the calculus?

**Not for this problem.** Two specifics, both verified rather than assumed:

**Parallel execution is across transactions, not within one.** Monad's docs
describe optimistic concurrent execution of *transactions* in a block, with
state merged sequentially to check conflicts. A single compute-heavy contract
call executes sequentially exactly as on Ethereum. A 50M-gas inference — or a
150M-gas training step — gets zero benefit. Higher TPS does not make one heavy
call cheaper.

**Higher block gas limit helps modestly.** 150M vs Ethereum's ~30M is 5×, which
is the difference between "impossible" and "still impossible". And there is a
per-transaction cap well below the block limit (a 65M-gas transaction is
rejected).

Two Monad-specific properties that *do* matter, and cut in opposite directions:

- **Fees are charged on the declared gas limit, not gas used.** Padding a gas
  limit costs real money. Any iterative on-chain training loop, where per-step
  gas is hard to predict exactly, pays for its own uncertainty every step.
- **`debug_traceCall` is available on the public RPC** (the `trace_*` namespace
  is not). This is genuinely useful and is what produced §2.1's table — full
  per-layer observability of a real inference, ~2 MB and ~1 second for this
  model. It makes the EVM a legible target for profiling ML workloads, which is
  rarer than it should be.

---

## 6. Honest assessment

**Feasible now**
- Inference for small models (linear, small CNN/MLP/RNN) directly in contracts.
- Storing model weights on-chain as the canonical artifact — this repo does it
  for 3,150 int8 parameters in 6.9M gas.
- On-chain aggregation/governance over off-chain-computed updates.
- Verified inference through zkML or opML where the verification cost is
  justified by the value of the decision.

**Not feasible, and not close**
- Backpropagation in a contract for anything past a toy. Four to six orders of
  magnitude, dominated by memory addressing that no amount of quantization
  fixes.
- Training anything at modern model scale, on any L1, by any margin.
- "The chain trains the model" as a product claim. When you see it, the gradient
  computation is happening somewhere else; find out where.

**The interesting middle**
The genuinely useful property is not that computation happens on-chain — it is
that computation is *verifiable* and weights are *canonical and inspectable*.
This project's value is not that 50.8M gas is a good way to classify a digit
(it is a terrible way). It is that anyone can independently re-execute the
classification and get a bit-identical answer, and that the weights cannot be
swapped without leaving a record. Those properties are worth paying for in
narrow, high-stakes settings. Raw throughput is not the bottleneck being
addressed, and framing on-chain ML as a performance story misreads what it is
for.

---

## Sources

- [On-Chain Decentralized Learning and Cost-Effective Inference for DeFi Attack Mitigation (AFT 2025)](https://arxiv.org/pdf/2510.16024)
- [ML2SC: Deploying Machine Learning Models as Smart Contracts on the Blockchain](https://arxiv.org/pdf/2404.16967)
- [Generation of Optimized Solidity Code for Machine Learning Models using LLMs](https://arxiv.org/html/2503.06203v1)
- [The Definitive Guide to ZKML (2025)](https://blog.icme.io/the-definitive-guide-to-zkml-2025/)
- [A Survey of Zero-Knowledge Proof Based Verifiable Machine Learning](https://arxiv.org/pdf/2502.18535)
- [zk-OPML: Using zero-knowledge proofs to optimize OPML](https://github.com/Vid201/zk-OPML) · [paper](https://link.springer.com/article/10.1007/s44443-026-00573-1)
- [Federated Learning using Smart Contracts on Blockchain (J.P. Morgan)](https://www.jpmorgan.com/content/dam/jpm/cib/complex/content/technology/publications/publication-smartcontracts.pdf)
- [Advancing Blockchain-based Federated Learning through Verifiable Off-chain Computations](https://arxiv.org/pdf/2206.11641)
- [SoK: Verifiable Federated Learning](https://eprint.iacr.org/2025/2296.pdf)
- [Monad: Parallel Execution](https://docs.monad.xyz/monad-arch/execution/parallel-execution)
- [Monad: RPC limits](https://docs.monad.xyz/reference/rpc-limits)
- [Monad: Testnet changelog (2025-12-16 re-genesis)](https://docs.monad.xyz/developer-essentials/changelog/testnet)

Measured figures for this repo come from `debug_traceCall` against
MNISTNFT on Monad testnet, token 1 — `0x348a1c5cc416e4d3b1d2d28697c766918f21c368`
at the time of measurement, since redeployed at
`0x4420fe892e106939aed7165dbca4a5caa65e8647` with a packed-calldata `mint`.
The inference path is unchanged, so the gas figures still hold. Reproduce with `npx tsx scripts/verify.ts --target monadTestnet`
and the trace path in `lib/trace.ts`.
