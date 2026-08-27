import { decodeAbiParameters, encodeFunctionData, parseAbiParameters, type PublicClient } from "viem"

import { MNIST_NFT_ABI } from "./abi"

/**
 * Run one inference and take it apart: the prediction, the per-layer
 * activations, the call sequence the EVM executed, and the gas each call
 * burned -- from a *single* execution on the node.
 *
 * MNISTNFT.inference delegates every layer to Convolution2D / FullyConnectedLayer
 * via external calls, so `debug_traceCall` with the callTracer exposes each
 * layer's return data and its cost, and the root call's own output is the
 * prediction itself. Calling `inference` separately as well would mean paying
 * for the same ~50M gas of work twice for one click.
 *
 * The storage layout comes from a second tracer that cannot be combined with
 * the first -- see `loadStorageLayout`, which is opt-in and cached, because the
 * weights it reports are the same for every image.
 *
 * Monad's public RPC supports the debug_* namespace (trace_* is not exposed).
 */

// Function selectors on the two math contracts.
const SEL = {
  conv2D: "0x65f070d2",
  maxPool2D: "0xc351c92f",
  flatten3D: "0xd2525993",
  fullyConnected: "0xa195cc6f",
  relu: "0x94d5e4c2",
  argmax: "0x4ef52e90",
} as const

type FnName = keyof typeof SEL
const NAME_OF = Object.fromEntries(Object.entries(SEL).map(([k, v]) => [v, k])) as Record<string, FnName>

/** Gas handed to the traced call. inference alone burns ~50M. */
const SUPPLIED_GAS = 100_000_000

type CallNode = {
  error?: string
  input?: string
  output?: string
  to?: string
  type?: string
  gasUsed?: string
  calls?: CallNode[]
}

/** [channels][height][width] */
export type FeatureMaps = number[][][]

/** One external call the EVM made, in execution order. */
export type CallRecord = {
  fn: FnName
  to: `0x${string}`
  type: string
  gas: number
  /** Gas burned by every call before this one. */
  gasBefore: number
  /**
   * The exact calldata, kept only for the structural calls. The math contracts
   * are pure, so this is enough to re-issue any single layer on its own and
   * time it. Skipped for relu -- 3,528 copies would be pointless weight.
   */
  data?: `0x${string}`
}

/** A stage of the network: its structural call plus any ReLU calls that follow. */
export type Stage = {
  key: "conv1" | "pool1" | "conv2" | "pool2" | "flatten" | "fc" | "argmax"
  label: string
  /** Inclusive index range into `calls`. */
  from: number
  to: number
  gas: number
  calls: number
}

export type ContractUsage = {
  address: `0x${string}`
  label: string
  role: string
  calls: number
  gas: number
}

/** Where the weights physically are, from `prestateTracer`. */
export type StorageLayout = {
  /** Storage keys the inference read from MNISTNFT. */
  slots: `0x${string}`[]
  /** Deployed code size per address. */
  codeBytes: Record<string, number>
}

export type InferenceTrace = {
  conv1: FeatureMaps
  pool1: FeatureMaps
  conv2: FeatureMaps
  pool2: FeatureMaps
  flatten: number[]
  logits: number[]
  prediction: number
  /** How many external calls the EVM actually made, by function. */
  callCounts: Record<string, number>
  totalCalls: number
  traceBytes: number
  elapsedMs: number

  // --- chain-level ---
  /** Every external call, in execution order. */
  calls: CallRecord[]
  stages: Stage[]
  contracts: ContractUsage[]
  /**
   * Gas the whole inference burned, entry call included -- or null when the node
   * will not say. Monad's callTracer reports the *supplied* gas as the root's
   * gasUsed, so the number is only trustworthy when it comes in below the limit.
   */
  gasTotal: number | null
  /** Gas attributable to the external calls (what the timeline plots). */
  gasCalls: number
  /** Block the call was executed against. */
  blockNumber: bigint
}

const decode3D = (hex: string): FeatureMaps =>
  (decodeAbiParameters(parseAbiParameters("int256[][][]"), hex as `0x${string}`)[0] as bigint[][][]).map((c) =>
    c.map((row) => row.map(Number))
  )

const decode1D = (hex: string): number[] =>
  (decodeAbiParameters(parseAbiParameters("int256[]"), hex as `0x${string}`)[0] as bigint[]).map(Number)

const STAGE_LABEL: Record<Stage["key"], string> = {
  conv1: "conv1 + ReLU",
  pool1: "pool1",
  conv2: "conv2 + ReLU",
  pool2: "pool2",
  flatten: "flatten",
  fc: "fc",
  argmax: "argmax",
}

/**
 * Split the flat call list into network stages.
 *
 * The trace is flat -- MNISTNFT calls every helper itself, so a conv layer
 * appears as one conv2D call followed by a run of thousands of relu calls.
 * A new stage opens on each non-relu call; relu calls attach to the stage
 * already open.
 */
function toStages(calls: CallRecord[]): Stage[] {
  const order: Stage["key"][] = ["conv1", "pool1", "conv2", "pool2", "flatten", "fc", "argmax"]
  const stages: Stage[] = []
  let next = 0

  calls.forEach((call, i) => {
    if (call.fn !== "relu") {
      const key = order[next++]
      if (!key) return
      stages.push({ key, label: STAGE_LABEL[key], from: i, to: i, gas: call.gas, calls: 1 })
      return
    }
    const current = stages[stages.length - 1]
    if (!current) return
    current.to = i
    current.gas += call.gas
    current.calls++
  })

  return stages
}

export async function traceInference(
  client: PublicClient,
  /** Which deployment to call -- the app can be pointed at several networks. */
  contract: `0x${string}`,
  tokenId: bigint,
  grid: number[][]
): Promise<InferenceTrace> {
  const data = encodeFunctionData({
    abi: MNIST_NFT_ABI,
    functionName: "inference",
    args: [tokenId, grid.map((row) => row.map((v) => BigInt(v)))],
  })
  const request = { to: contract, data, gas: `0x${SUPPLIED_GAS.toString(16)}` }

  const started = performance.now()
  const [result, blockNumber] = await Promise.all([
    client.request({
      method: "debug_traceCall" as any,
      params: [request, "latest", { tracer: "callTracer" }] as any,
    }) as Promise<CallNode>,
    client.getBlockNumber(),
  ])
  const elapsedMs = Math.round(performance.now() - started)

  if (result.error) throw new Error(`inference reverted: ${result.error}`)

  const children = result.calls ?? []
  const selectorOf = (c: CallNode) => (c.input ?? "").slice(0, 10)
  const pick = (sel: string) => children.filter((c) => selectorOf(c) === sel)

  const convs = pick(SEL.conv2D)
  const pools = pick(SEL.maxPool2D)
  const flat = pick(SEL.flatten3D)[0]
  const fc = pick(SEL.fullyConnected)[0]
  const argmax = pick(SEL.argmax)[0]

  if (convs.length < 2 || pools.length < 2 || !flat || !fc || !argmax) {
    throw new Error("trace did not contain the expected layer calls")
  }

  const callCounts: Record<string, number> = {}
  const calls: CallRecord[] = []
  let gasCalls = 0
  for (const child of children) {
    const fn = NAME_OF[selectorOf(child)]
    if (!fn) continue
    const gas = Number(BigInt(child.gasUsed ?? "0x0"))
    calls.push({
      fn,
      to: (child.to ?? "0x") as `0x${string}`,
      type: child.type ?? "CALL",
      gas,
      gasBefore: gasCalls,
      ...(fn === "relu" ? {} : { data: child.input as `0x${string}` }),
    })
    gasCalls += gas
    callCounts[fn] = (callCounts[fn] ?? 0) + 1
  }

  // Which address is which contract is read off the trace, not assumed.
  const addressOf = (fn: FnName) => calls.find((c) => c.fn === fn)?.to ?? ("0x" as `0x${string}`)
  const convAddress = addressOf("conv2D")
  const fcAddress = addressOf("fullyConnected")

  const usage = (address: `0x${string}`) =>
    calls.reduce(
      (acc, c) => (c.to.toLowerCase() === address.toLowerCase() ? { calls: acc.calls + 1, gas: acc.gas + c.gas } : acc),
      { calls: 0, gas: 0 }
    )

  // Monad answers with the gas we supplied rather than the gas consumed, so
  // anything at or above the limit is not a measurement.
  const rootGas = Number(BigInt(result.gasUsed ?? "0x0"))
  const gasTotal = rootGas > 0 && rootGas < SUPPLIED_GAS ? rootGas : null

  const contracts: ContractUsage[] = [
    {
      address: contract,
      label: "MNISTNFT",
      role: "holds the weights, drives the forward pass",
      calls: 1,
      gas: gasTotal === null ? 0 : gasTotal - gasCalls,
    },
    {
      address: convAddress,
      label: "Convolution2D",
      role: "conv2D · maxPool2D · flatten3D",
      ...usage(convAddress),
    },
    {
      address: fcAddress,
      label: "FullyConnectedLayer",
      role: "fullyConnected · relu · argmax",
      ...usage(fcAddress),
    },
  ]

  return {
    conv1: decode3D(convs[0].output!),
    pool1: decode3D(pools[0].output!),
    conv2: decode3D(convs[1].output!),
    pool2: decode3D(pools[1].output!),
    flatten: decode1D(flat.output!),
    logits: decode1D(fc.output!),
    // The root call's own return value -- this is the prediction. No second
    // call to inference() is made.
    prediction: Number(
      decodeAbiParameters(parseAbiParameters("uint256"), result.output! as `0x${string}`)[0]
    ),
    callCounts,
    totalCalls: children.length,
    traceBytes: JSON.stringify(result).length,
    elapsedMs,

    calls,
    stages: toStages(calls),
    contracts,
    gasTotal,
    gasCalls,
    blockNumber,
  }
}

/**
 * Time each layer for real, by re-issuing its call on its own.
 *
 * The trace gives gas, never wall-clock -- an EVM trace has no timestamps. But
 * Convolution2D and FullyConnectedLayer are pure, and the trace preserved the
 * exact calldata each layer received, so every layer can be replayed as a
 * standalone `eth_call` and timed.
 *
 * Each number therefore includes one RPC round trip, and the sum will exceed
 * the single combined call. It is a measurement of that layer's cost, not a
 * decomposition of the original call's latency.
 */
export async function measureStageTimes(
  client: PublicClient,
  trace: InferenceTrace
): Promise<(number | null)[]> {
  const times: (number | null)[] = []
  for (const stage of trace.stages) {
    const call = trace.calls[stage.from]
    if (!call.data) {
      times.push(null)
      continue
    }
    const started = performance.now()
    try {
      await client.call({ to: call.to, data: call.data })
      times.push(Math.round(performance.now() - started))
    } catch {
      times.push(null)
    }
  }
  return times
}

/**
 * Which storage words the inference reads, via `prestateTracer`.
 *
 * This cannot ride along with the callTracer -- one tracer per call -- so it is
 * a second execution of the same work. It is therefore opt-in, and cached: the
 * weights it reports do not depend on the image, so once per model is enough.
 */
let layoutCache: { key: string; layout: StorageLayout } | null = null

export async function loadStorageLayout(
  client: PublicClient,
  contract: `0x${string}`,
  tokenId: bigint,
  grid: number[][]
): Promise<StorageLayout> {
  const key = `${contract}:${tokenId}`
  if (layoutCache?.key === key) return layoutCache.layout

  const data = encodeFunctionData({
    abi: MNIST_NFT_ABI,
    functionName: "inference",
    args: [tokenId, grid.map((row) => row.map((v) => BigInt(v)))],
  })
  const prestate = (await client.request({
    method: "debug_traceCall" as any,
    params: [
      { to: contract, data, gas: `0x${SUPPLIED_GAS.toString(16)}` },
      "latest",
      { tracer: "prestateTracer" },
    ] as any,
  })) as Record<string, { storage?: Record<string, string>; code?: string }>

  const codeBytes: Record<string, number> = {}
  for (const [address, entry] of Object.entries(prestate)) {
    codeBytes[address.toLowerCase()] = entry.code ? (entry.code.length - 2) / 2 : 0
  }
  const slots = Object.keys(
    prestate[contract]?.storage ??
      prestate[contract.toLowerCase()]?.storage ??
      {}
  ) as `0x${string}`[]

  const layout = { slots, codeBytes }
  layoutCache = { key, layout }
  return layout
}
