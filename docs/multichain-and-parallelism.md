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

## No, and the reason is structural

Monad's parallelism is **optimistic concurrency across the transactions in a
block**: transactions start before their predecessors finish, their reads and
writes are watched for conflicts, and conflicting ones are re-executed, with
state merged in the original order. The unit of parallelism is a transaction.

A prediction is one call. It executes on one thread, and its layers are strictly
sequential — conv1 feeds pool1 feeds conv2 — so there is nothing for a
transaction-level scheduler to overlap. Nothing in Monad's design parallelises
the inside of a single execution, and this workload is a single execution by
necessity: at 58.93M gas it is above Monad's own 30M per-transaction cap, so it
can never even enter a block to be scheduled against anything.

That last point is worth sitting with. Monad's parallel execution is the part of
the chain this project can least use, because the project's core operation is
categorically not a transaction.

## What Monad does give this project

Measured, not inferred:

- **A 150M-gas `eth_call` budget** — exactly the block gas limit, and 2.5× what
  this call needs. Without it the demo has no home; Arbitrum shows what happens
  when the ceiling is 50M.
- **~62 ms execution**, 4-6× faster than the other four. That is interpreter and
  state-access speed (MonadDb keeps the trie in a purpose-built store and serves
  reads asynchronously), not parallelism.
- **Both tracers on the public RPC**, which is what the execution replay is built
  from.

Concurrency across *separate* predictions does scale, which is what matters for
serving many users at once — though this is ordinary RPC thread-pooling, present
on Ethereum too, not Monad's block-level scheduler:

| concurrent calls | Monad throughput | Ethereum throughput |
| --- | --- | --- |
| 1 | 9.4 calls/s | 1.6 calls/s |
| 4 | 8.2 calls/s | 5.2 calls/s |
| 8 | 14.0 calls/s | 8.8 calls/s |

## Where the 58.93M actually goes

If the goal is a faster prediction, this is the table that matters. Taken from
one `callTracer` trace of a real prediction:

| what | calls | gas | share |
| --- | --- | --- | --- |
| `conv2D` | 2 | 45,570,348 | 77.3% |
| MNISTNFT's own frame | — | 8,092,898 | 13.7% |
| `maxPool2D` | 2 | 2,649,197 | 4.5% |
| `fullyConnected` | 1 | 1,673,810 | 2.8% |
| `relu` | 3,528 | 748,727 | 1.3% |
| `flatten3D` | 1 | 190,291 | 0.3% |
| `argmax` | 1 | 2,706 | 0.0% |

Two things stand out.

**`conv2D` is the whole problem.** Two calls, 77% of the gas. Any real speedup
is a better convolution, not a better chain. The current one works in
`int[][][] memory` — 256 bits per pixel for values that are int8 weights and
bounded activations — so most of the gas is memory expansion and word-at-a-time
copying of data that would fit 32-to-a-word. The mint path already packs weights
32 int8 per storage word; the compute path unpacks all of it back into full
words before doing any arithmetic.

**`relu`'s 3,528 external calls are a trap for the eye.** They are 99.8% of the
call count and 1.3% of the gas, at 212 gas each. Inlining `relu` into MNISTNFT
would remove almost every call in the trace and shrink the trace JSON from
~2 MB, which would make the *demo* much lighter — but it saves under 1.3% of the
gas, and would delete the most striking thing the visualisation shows. That is a
UI decision, not a performance one.

The 13.7% in MNISTNFT's own frame is `_rebuild4D`/`_rebuild2D` unpacking the
packed weights into memory arrays on *every* prediction, plus the ABI encoding
of those arrays for each external call. Unlike `relu`, this is real money: the
weights are identical for every image, and the work is repeated per call.

## What would actually make it faster

In descending order of payoff, none of which involve the chain:

1. **Keep the activations packed.** Operate on `bytes`/`uint256` words instead of
   `int[][][]`, unpacking per multiply-accumulate rather than materialising every
   intermediate as one word per element. This attacks the 77%.
2. **Stop rebuilding the weights per call** — 13.7% spent re-deriving something
   that never changes between predictions.
3. **Collapse the layer boundaries.** Every external call re-encodes the entire
   activation tensor as calldata and re-decodes it. Fusing conv+relu+pool into
   one contract call removes two full tensor round trips.
4. **Inline `relu`** — only if the visualisation is not the point, since it costs
   the demo more than it saves the chain.

If all of that got the call under **30,000,000 gas**, something qualitatively
new becomes possible: the prediction fits in a Monad transaction. Then it can be
minted, logged, composed with, and — finally — scheduled in parallel with other
users' predictions by the block-level scheduler this section opened with. That is
the only route by which Monad's parallel execution ever helps this project, and
it runs through the Solidity, not the chain.

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
