# Where Else This Can Run, and Whether Monad's Parallelism Helps

Research notes, August 2026. Two questions, both answered against this repo's
own deployed contracts rather than from documentation: can the same contracts
and NFT live on Ethereum, Arbitrum One, OP Mainnet and BNB Chain, and can
Monad's parallel execution make the forward pass faster.

Every number below was measured. The method is at the end; it is worth reading,
because one trick — replaying this repo's exact contracts and weights onto four
other chains with `eth_call` state overrides — is what made a real comparison
possible without deploying anything or spending anything.

---

## Bottom line

**The contracts deploy anywhere. The inference call does not fit in a
transaction anywhere — including Monad.**

At 58,927,977 gas, one prediction is larger than the per-transaction gas cap on
every chain examined:

| Chain | per-tx cap | source of the cap |
| --- | --- | --- |
| Ethereum | 16,777,216 | EIP-7825, live since Fusaka |
| OP Mainnet | 16,777,216 | EIP-7825 via OP Stack |
| BNB Chain | 16,777,216 | BEP-652 |
| Monad | 30,000,000 | protocol |
| Arbitrum One | 32,000,000 effective | per-block execution limit |

This is not a Monad-versus-the-rest finding. It is a property of the workload:
`inference()` is, and can only ever be, a read-only `eth_call`. The app already
frames it that way ("no wallet, no gas, no signature") — that framing turns out
to be a necessity, not a design choice.

As an `eth_call`, it runs on **Ethereum, OP Mainnet and BNB Chain today**, and
**fails on Arbitrum One**, whose 50,000,000-gas RPC ceiling is about 9.4M short.

The thing that actually degrades on all four is the demo itself: none of their
standard public RPCs serve `debug_traceCall`, so the execution replay and the
layer-by-layer trace — the parts that make this project worth looking at — fall
back to a bare prediction.

**Monad's parallel execution cannot speed up one prediction.** It parallelises
across transactions in a block; a single call is one execution on one thread.
Monad is measurably ~4-6× faster at this call than the others, but that comes
from its interpreter and state layer, not from parallelism. The real speedups
available are in this repo's own Solidity, not in the chain.

---

# Part 1 — Ethereum, Arbitrum, OP, BNB

## What deploys without any trouble

Nothing here is chain-specific. The three contracts are plain Solidity
^0.8.0 with no precompiles, no `blockhash`/`prevrandao` dependence, no
chain-specific opcodes, and the NFT is an ordinary ERC-721. Deployed size is
the usual first thing to check and it is not close to a problem:

| Contract | deployed bytecode | EIP-170 limit |
| --- | --- | --- |
| MNISTNFT | 8,388 bytes | 24,576 |
| Convolution2D | 3,237 bytes | 24,576 |
| FullyConnectedLayer | 1,310 bytes | 24,576 |

Minting is an ordinary transaction and fits everywhere: **3,707,536 gas**, with
4,420 bytes of calldata (59,152 gas of it), well under every chain's 16,777,216
per-transaction cap. On the rollups the 4,420 bytes also carry an L1 data cost,
which is the one place Arbitrum and OP charge meaningfully more than their
posted gas price suggests.

So: yes, the same contracts and the same NFT can be deployed on all four. That
was never the interesting part of the question.

## The interesting part: the inference call

The forward pass needs **58,927,977 gas on Monad and 59,358,276 on Ethereum,
OP and BNB** — measured by bisecting the `gas` field of an `eth_call` until it
stops completing, not estimated. The 0.7% spread is the only gas-schedule
difference between the five chains for this code; EVM equivalence holds.

That number is above every per-transaction cap in the table above, so the only
way to run it is `eth_call`, where a different limit applies — each RPC's own
gas ceiling:

| Chain | `eth_call` ceiling (measured) | block gas limit | block time | 58.93M call |
| --- | --- | --- | --- | --- |
| Monad | 150,000,000 | 150,000,000 | 0.27 s | runs |
| Ethereum | 224,414,062 | 60,000,000 | 12.0 s | runs |
| OP Mainnet | 101,562,500 | 40,000,000 | 2.0 s | runs |
| BNB Chain | > 300,000,000 | 55,000,000 | 0.45 s | runs |
| Arbitrum One | **50,000,000** | 32,000,000 effective | 0.27 s | **fails** |

Arbitrum's ceiling is exact: a call needing more than 49,500,000 gas succeeds
and one needing more than 50,000,000 does not. That is Nitro's `rpc.gascap`
default, so a self-hosted node or a provider that raised it would run this
fine — but nothing about Arbitrum's *protocol* limits stops it. On the public
endpoint, it is 9.4M gas short and there is no way around that from the client.

## Speed, measured on the same call

The same call, the same contracts, the same weights, replayed on each chain and
timed from the same machine. Baseline is the median round trip of an
`eth_chainId` to the same endpoint, so the delta approximates execution:

| Chain | baseline RTT | inference call | execution (delta) |
| --- | --- | --- | --- |
| **Monad** | 46 ms | 107 ms | **~62 ms** |
| Ethereum | 50 ms | 288 ms | ~237 ms |
| BNB Chain | 42 ms | 356 ms | ~314 ms |
| OP Mainnet | 144 ms | 524 ms | ~380 ms |
| Arbitrum One | 68 ms | — | call refused |

Monad executes this call roughly 4-6× faster than the others. Two caveats worth
stating plainly: these are different operators' machines under different load,
not a controlled comparison of chain software; and a first measurement pass gave
Monad *slower* results than Ethereum until the input was varied per call —
several of these providers cache `eth_call`, and an identical repeated call is
answered from that cache rather than executed. Every figure above uses a
different image each run.

## What breaks on all four: the tracer

The demo's two most interesting panels — the gas-space execution replay and the
per-layer activations — both come from a single `debug_traceCall`. That method
is not available on the standard public endpoint of any of the four:

| Chain | endpoint | `debug_traceCall` |
| --- | --- | --- |
| Ethereum | ethereum-rpc.publicnode.com | no |
| Ethereum | eth.drpc.org | **yes** |
| Arbitrum One | arb1.arbitrum.io/rpc, publicnode | no |
| OP Mainnet | mainnet.optimism.io, publicnode | no |
| OP Mainnet | optimism.drpc.org | **yes** |
| BNB Chain | bsc-dataseed, publicnode | no |
| BNB Chain | bsc.drpc.org | **yes** |
| Monad | rpc.monad.xyz | yes, with `prestateTracer` too |

The app already degrades correctly here — it falls back to a plain `eth_call`
and shows the prediction without the trace — but on Ethereum, OP and BNB that
fallback would be the *normal* path unless a tracing provider is configured.
Monad's public RPC serving both `callTracer` and `prestateTracer` with a 150M
gas budget is the single most load-bearing thing about running this demo there.

## Verdict per chain

- **Ethereum.** Deploys and runs as a read-only call, with the most generous
  `eth_call` ceiling of the five (224M). ~237 ms per prediction. Needs a tracing
  provider for the visualisation. Minting is cheap at current base fees
  (3.71M gas × ~0.042 gwei), but that is a spot price, not a property.
- **BNB Chain.** Deploys and runs, ~314 ms, huge `eth_call` headroom, 0.45 s
  blocks. Needs a tracing provider. Closest thing to a drop-in second home.
- **OP Mainnet.** Deploys and runs, ~380 ms — the slowest of the four that work.
  Needs a tracing provider. Mint calldata carries an L1 data cost.
- **Arbitrum One.** Deploys, mints, and then cannot answer a prediction on the
  public RPC: 50M ceiling against a 59.36M call. Would need a node with a raised
  `rpc.gascap`. Also no public tracer.

---

# Part 2 — Can Monad's parallel execution speed up the forward pass?

A convolutional network is one of the most parallel things in computing. The
question is not whether the parallelism exists — it does, in enormous quantity —
but whether an EVM contract on Monad can spend any of it.

## How much parallelism is actually there

The network is 3 conv/pool stages and one fully-connected layer:

| layer | independent outputs | MACs each | MACs |
| --- | --- | --- | --- |
| conv1 | 3 × 28 × 28 = 2,352 | 9 | 21,168 |
| conv2 | 6 × 14 × 14 = 1,176 | 27 | 31,752 |
| fc | 10 | 294 | 2,940 |
| | | | **55,860** |

Every output within a layer is independent of every other. The critical path is
only nine stages deep — conv1, relu, pool1, conv2, relu, pool2, flatten, fc,
argmax — and the widest layer is 2,352-way parallel. Work over depth is in the
thousands. On a GPU this is a rounding error of a kernel launch.

So the parallelism is there. There are exactly three places it could be spent on
a blockchain, and they behave completely differently.

## 1. Across transactions — this is Monad's parallelism, and it makes things worse

To hand work to Monad's block-level scheduler you have to express it as separate
transactions. Two things kill that, and both are measurable.

**The channel between transactions is storage, and storage is ~75× memory.**
Transactions share nothing but state: whatever one computes for the next must be
written to storage and read back. Measured on Monad, with the same contract
writing and reading back N words:

| words | in memory | per word | in storage | per word | ratio |
| --- | --- | --- | --- | --- | --- |
| 32 | 31,946 | 998 | 929,293 | 29,040 | 29× |
| 128 | 61,581 | 481 | 3,652,312 | 28,534 | 59× |
| 294 | 112,843 | 384 | 8,360,926 | 28,439 | 74× |

conv1's output is 2,352 activations. Packed eight to a word that is 294 words:
**8,360,926 gas just to publish one layer boundary**, and 294 words is the
optimistic case — as one int256 each, the shape the deployed contract actually
uses, it is 2,352 words and about **67M gas, more than the entire inference
costs today**. Four layer boundaries at the packed price is ~33M gas of pure
handoff, before a single multiply. Transient storage (EIP-1153) does not rescue
this: it is cleared at the end of each transaction, so it cannot be a channel
*between* transactions.

**And the layers are a dependency chain, which is the worst case for optimistic
concurrency.** Monad starts later transactions before earlier ones finish and
re-executes any whose reads turn out to be stale. conv2 reads exactly what
pool1 writes, so a split-by-layer design would have every stage speculatively
executed, detected as conflicting, and re-executed in order — paying for the
work twice to arrive at the same serial schedule. Optimistic concurrency pays
off on *independent* transactions; a nine-deep chain is the case it is worst at.

Splitting by output element instead of by layer avoids the dependency chain
within a layer, but multiplies the handoff: 21,000 gas of intrinsic cost per
transaction, and 2,352 transactions for conv1 alone is 49M gas before any
arithmetic or any storage.

## 2. Inside one transaction, across calls — the EVM forbids it

The natural thought is to let the *node* overlap the independent work inside one
call. The EVM has no primitive for it. `CALL` is synchronous by definition:
control transfers, runs to completion, and returns. There is no fork, no async,
no way to express "these two calls are independent."

Worse, the gas counter is itself a serial dependency. Every opcode's execution
is conditional on the remaining gas, the 63/64 rule makes the budget available
to one call a function of exactly how much the previous call consumed, and
running out mid-way must revert everything after it. An implementation cannot
speculatively execute two sibling calls concurrently without changing what gas
metering means. Monad is EVM-equivalent, so this binds it exactly as it binds
geth.

This is not an oversight — it is the reason the caps in Part 1 exist. EIP-7825's
stated motivation is that a single transaction able to fill a block *inhibits
parallel execution*. Ethereum, OP and BNB capped transactions at 2²⁴ gas
specifically so that blocks contain many small transactions a scheduler can
spread across cores. This workload is the thing those caps were written to
prevent.

## 3. Inside a 256-bit word — this one works, and it is worth 8–10×

An EVM word is 256 bits. The activations here are 8-bit inputs and accumulators
that never exceed about 2¹⁸; the weights are int8. Putting eight activations in
one word at 32 bits each and multiplying by a broadcast weight does **eight
multiply-accumulates in one `MUL`** — the same data parallelism a GPU exploits,
at width 8 instead of thousands.

`contracts/ConvBench.sol` implements both conv layers twice: once in the shape
the deployed `Convolution2D` uses, once packed. Both read the real weights out
of the deployed model's storage, and both return a checksum of the post-ReLU
output, so a faster number cannot be a wrong one. Run with
`node scripts/bench-conv.mjs`:

| layer | one int256 per activation | 8 packed per word | | |
| --- | --- | --- | --- | --- |
| conv1 (1→3, 28×28) | 23,160,416 gas · 1,094/MAC | 2,996,586 gas · 142/MAC | **7.7×** | checksums match |
| conv2 (3→6, 14×14) | 36,787,180 gas · 1,159/MAC | 3,705,128 gas · 117/MAC | **9.9×** | checksums match |

Two details that constrain how far this goes:

**The EVM has no per-lane signed arithmetic.** A negative lane would borrow from
its neighbour. The kernel accumulates positive and negative weights into two
separate non-negative accumulators and subtracts at the end — correct, and it
costs nothing beyond a second accumulator.

**Lane width shrinks as activations grow.** With 32-bit lanes and this model's
weights, the largest conv2 input activation is 133,604, leaving 9× headroom
before a lane could carry into its neighbour — measured, and printed by the
script. But activations keep growing: by `fc` they reach ~10¹³, which needs
64-bit lanes and drops the width from 8 to 4. SIMD width is not constant through
a network; it is set by the widest intermediate.

Even 117 gas per MAC is 15× above the ~8 gas an `ADD` plus a `MUL` costs, so
this is nowhere near the floor. The remaining overhead is Solidity's memory
allocation and bounds checks around the arithmetic, most of which assembly would
remove.

## What it adds up to

Applying the measured ratios to the real breakdown, and treating the rest
conservatively:

| | today | packed | why |
| --- | --- | --- | --- |
| conv2D ×2 | 45.57M | ~5.2M | measured, 7.7–9.9× |
| MNISTNFT's own frame | 8.09M | ~0.5M | weights are already stored packed; stop unpacking them |
| maxPool2D ×2 | 2.65M | ~1.3M | per-lane max has no SIMD form; assume only 2× |
| fullyConnected | 1.67M | ~0.4M | 64-bit lanes, so width 4 not 8 |
| relu ×3,528 | 0.75M | ~0.3M | a per-lane clamp inside the pipeline, not 3,528 calls |
| flatten3D, argmax | 0.19M | ~0.05M | |
| **total** | **58.93M** | **~7.8M** | |

That number is the whole point, because it crosses two thresholds at once. Below
**30,000,000** the prediction fits in a Monad transaction. Below **16,777,216**
it fits in a transaction on Ethereum, OP and BNB too. A projection is not a
measurement, but the two layers carrying 77% of the gas are measured, and the
margin is large enough that even being 2× pessimistic still clears Monad's cap.

## And *then* Monad's parallelism finally matters

Once a prediction is a transaction, the picture inverts. Inferences from
different users share nothing: each reads the model's storage and writes only
its own result. That is precisely the workload optimistic concurrency is best
at — no conflicts, no re-execution, straight-line speedup across cores.

At ~8M gas per prediction:

| | gas per block | predictions per block | block time | on-chain predictions/s |
| --- | --- | --- | --- | --- |
| Monad | 150M | ~18 | 0.4 s | **~45** |
| Ethereum | 60M | ~7 | 12 s | ~0.6 |
| BNB Chain | 55M | ~6 | 0.45 s | ~13 |
| OP Mainnet | 40M | ~5 | 2 s | ~2.5 |

One design caveat that follows directly from how the scheduler works: this only
holds if the predictions do not touch a shared hot slot. The current `mint`
increments a single `_tokenIds` counter — every transaction reading and writing
that one slot conflicts with every other, and Monad's optimistic execution would
detect it, re-execute, and serialise the whole block. Recording results without
a shared counter (an address-derived id, or a per-sender nonce) is what turns
these into the independent transactions the scheduler can actually spread.

## So: can it be parallelised on Monad?

The parallelism in the network is real and enormous, and almost none of it is
reachable through Monad's parallel execution — because that mechanism operates
on transactions, and the cost of expressing this network as transactions
(≈28,400 gas per word of handoff, measured) exceeds by an order of magnitude the
cost of just doing the work sequentially in memory.

The parallelism that *is* reachable lives inside the 256-bit word, and it is
worth a measured 8–10×. Spending it is what makes a prediction small enough to
be a transaction — and only then does the chain's own parallelism become
available, at roughly 45 on-chain predictions per second on Monad against 0.6 on
Ethereum.

The order matters and it is counterintuitive: you do not use Monad's parallelism
to make the network fast. You make the network fast, by hand, in order to earn
access to Monad's parallelism.

---

## Method

Everything above is reproducible without deploying or spending anything.

**Cross-chain replay.** `debug_traceCall` with `prestateTracer` on Monad returns
every account and storage slot the prediction touches — 3 accounts, 12,935 bytes
of code, 128 slots, 42.7 KB of JSON. Fed back as an `eth_call` state override,
that is enough to run this repo's exact contracts and exact weights on any chain
whose RPC honours overrides. All four do (verified independently: an injected
`stateDiff` reads back correctly on each). Every chain returned the same
prediction for the same image.

**Gas.** Bisected the `eth_call` `gas` field to the nearest 10,000 until the call
stopped completing. `eth_estimateGas` is not usable here: on these public
endpoints it ignores state overrides, so it reports a revert.

**RPC ceilings.** Injected a 13-byte contract that reverts unless
`gasleft()` exceeds a threshold, then bisected the threshold. This measures what
the node actually grants rather than what it was asked for.

**Per-transaction caps.** Signed transactions from a fresh unfunded key at
various gas limits and read which rejection came back. A gas-cap refusal happens
before the balance check, so "insufficient funds" means the limit was accepted —
Ethereum accepts 16,777,216 and refuses 16,777,217; BNB names its cap in the
error; Monad accepts 30,000,000 and refuses 30,000,001.

**Timing.** Median of 5 calls, each with a different input image to defeat
provider-side `eth_call` caching, minus the median of 8 `eth_chainId` round
trips to the same endpoint.

**Convolution kernels.** `contracts/ConvBench.sol`, injected by
`scripts/bench-conv.mjs` the same way — state override, no deployment. It reads
the real conv1 and conv2 weights out of the deployed model's storage, runs each
layer both ways, and compares checksums of the post-ReLU output before reporting
any gas figure. Compiled with `viaIR` because the naive convolution runs out of
stack slots without it; both implementations are measured under identical
compiler settings, so the ratio is the finding rather than either absolute.

**Memory against storage.** The same contract's `writeMemory` / `writeStorage`,
bisected the same way, over the same word counts.
