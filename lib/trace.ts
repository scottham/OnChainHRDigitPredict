import { decodeAbiParameters, encodeFunctionData, parseAbiParameters, type PublicClient } from "viem"

import { MNIST_ABI } from "./abi"

/**
 * Run one inference on MNISTPacked and take it apart.
 *
 * There is nothing to see in a call trace of this contract. It makes no
 * external calls at all -- that is most of why a prediction costs ~10M gas
 * instead of MNISTNFT's ~59M -- so a callTracer reports one frame and a
 * prestateTracer is the only tracer left with anything to say. Everything the
 * page draws is therefore *asked for* rather than lifted out of a trace:
 *
 *   the label          inference()      one call, and the only one on the
 *                                       critical path -- this is the prediction
 *   the scores         logits()
 *   the feature maps   activations(s)   s = 2..5, unpacked on chain
 *   the cost per layer runTo(s)         via eth_estimateGas on prefixes of the
 *                                       pipeline, differenced
 *
 * All of it runs in parallel after the prediction returns, so the latency the
 * page reports is the prediction's own and nothing else's.
 */

/** Gas handed to a read call. A prediction burns ~10.2M. */
const SUPPLIED_GAS = 30_000_000

/** [channels][height][width] */
export type FeatureMaps = number[][][]

export type StageKey = "load" | "pack" | "conv1" | "pool1" | "conv2" | "pool2" | "flatten" | "fc"

/** Stage index as MNISTPacked.runTo numbers them. */
export const STAGES: StageKey[] = ["load", "pack", "conv1", "pool1", "conv2", "pool2", "flatten", "fc"]

export type StageCost = {
  key: StageKey
  /** Gas this stage alone costs -- the difference between two prefixes. */
  gas: number
  /** Gas from the start of the call through the end of this stage. */
  gasBefore: number
}

export type InferenceRun = {
  prediction: number
  logits: number[]
  conv1: FeatureMaps
  pool1: FeatureMaps
  conv2: FeatureMaps
  pool2: FeatureMaps
  /** Wall clock of the prediction call alone. */
  elapsedMs: number
  blockNumber: bigint
  /**
   * What the prediction costs, from eth_estimateGas -- or null if the node will
   * not estimate. Unlike MNISTNFT there is no trace to read a figure off, and
   * Monad's callTracer would report the gas supplied rather than the gas used.
   */
  gasTotal: number | null
  /** Per-layer cost, empty when the node would not estimate. */
  stages: StageCost[]
  contract: `0x${string}`
}

/** Where the weights physically are, from `prestateTracer`. */
export type StorageLayout = {
  slots: `0x${string}`[]
  codeBytes: Record<string, number>
}

const decode3D = (hex: string): FeatureMaps =>
  (decodeAbiParameters(parseAbiParameters("int256[][][]"), hex as `0x${string}`)[0] as bigint[][][]).map((c) =>
    c.map((row) => row.map(Number))
  )

function callData(fn: "inference" | "logits", tokenId: bigint, grid: number[][]) {
  return encodeFunctionData({
    abi: MNIST_ABI,
    functionName: fn,
    args: [tokenId, grid.map((row) => row.map((v) => BigInt(v)))],
  })
}

function stageData(fn: "runTo" | "activations", tokenId: bigint, grid: number[][], stage: number) {
  return encodeFunctionData({
    abi: MNIST_ABI,
    functionName: fn,
    args: [tokenId, grid.map((row) => row.map((v) => BigInt(v))), BigInt(stage)],
  })
}

/**
 * Cost per layer, by running prefixes of the pipeline and subtracting.
 *
 * Stage 0 is loading and unpacking the model, so the setup every stage shares
 * falls out of the difference. The eight estimates are independent and go out
 * together; the whole set takes about as long as one prediction.
 */
async function measureStageGas(
  client: PublicClient,
  contract: `0x${string}`,
  tokenId: bigint,
  grid: number[][]
): Promise<StageCost[]> {
  const estimates = await Promise.all(
    STAGES.map((_, stage) =>
      client
        .estimateGas({ to: contract, data: stageData("runTo", tokenId, grid, stage) })
        .then(Number)
        .catch(() => null)
    )
  )
  if (estimates.some((g) => g === null)) return []

  const cumulative = estimates as number[]
  let gasBefore = 0
  return STAGES.map((key, i) => {
    const gas = i === 0 ? cumulative[0] : cumulative[i] - cumulative[i - 1]
    const record = { key, gas: Math.max(gas, 0), gasBefore }
    gasBefore += record.gas
    return record
  })
}

export async function runInference(
  client: PublicClient,
  /** Which deployment to call -- the app can be pointed at several networks. */
  contract: `0x${string}`,
  tokenId: bigint,
  grid: number[][]
): Promise<InferenceRun> {
  // The prediction, alone, so the latency reported is only its own.
  const started = performance.now()
  const answer = await client.call({
    to: contract,
    data: callData("inference", tokenId, grid),
    gas: BigInt(SUPPLIED_GAS),
  })
  const elapsedMs = Math.round(performance.now() - started)
  if (!answer.data) throw new Error("inference returned no data")
  const prediction = Number(decodeAbiParameters(parseAbiParameters("uint256"), answer.data)[0])

  // Everything the page draws, gathered in parallel afterwards.
  const read = (stage: number) =>
    client
      .call({ to: contract, data: stageData("activations", tokenId, grid, stage), gas: BigInt(SUPPLIED_GAS) })
      .then((r) => decode3D(r.data!))

  const [scores, conv1, pool1, conv2, pool2, blockNumber, gasTotal, stages] = await Promise.all([
    client
      .call({ to: contract, data: callData("logits", tokenId, grid), gas: BigInt(SUPPLIED_GAS) })
      .then((r) => (decodeAbiParameters(parseAbiParameters("int256[]"), r.data!)[0] as bigint[]).map(Number)),
    read(2),
    read(3),
    read(4),
    read(5),
    client.getBlockNumber(),
    client
      .estimateGas({ to: contract, data: callData("inference", tokenId, grid) })
      .then(Number)
      .catch(() => null),
    measureStageGas(client, contract, tokenId, grid),
  ])

  return {
    prediction,
    logits: scores,
    conv1,
    pool1,
    conv2,
    pool2,
    elapsedMs,
    blockNumber,
    gasTotal,
    stages,
    contract,
  }
}

/**
 * Which storage words the inference reads, via `prestateTracer`.
 *
 * A second execution of the same work, so it is opt-in and cached: the weights
 * it reports do not depend on the image, so once per model is enough.
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

  const prestate = (await client.request({
    method: "debug_traceCall" as any,
    params: [
      { to: contract, data: callData("inference", tokenId, grid), gas: `0x${SUPPLIED_GAS.toString(16)}` },
      "latest",
      { tracer: "prestateTracer" },
    ] as any,
  })) as Record<string, { storage?: Record<string, string>; code?: string }>

  const codeBytes: Record<string, number> = {}
  for (const [address, entry] of Object.entries(prestate)) {
    codeBytes[address.toLowerCase()] = entry.code ? (entry.code.length - 2) / 2 : 0
  }
  const slots = Object.keys(
    prestate[contract]?.storage ?? prestate[contract.toLowerCase()]?.storage ?? {}
  ) as `0x${string}`[]

  const layout = { slots, codeBytes }
  layoutCache = { key, layout }
  return layout
}
