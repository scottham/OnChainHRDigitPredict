import { decodeAbiParameters, encodeFunctionData, parseAbiParameters, type PublicClient } from "viem"

import { CONTRACT_ADDRESS, MNIST_NFT_ABI } from "./contractConfig"

/**
 * Pull the real per-layer activations out of an on-chain inference.
 *
 * MNISTNFT.inference delegates every layer to Convolution2D / FullyConnectedLayer
 * via external calls, so `debug_traceCall` with the callTracer exposes each
 * layer's actual return data. Nothing here is simulated -- these are the values
 * the contracts computed.
 *
 * Monad's public RPC supports the debug_* namespace (trace_* is not exposed).
 * A trace of this call is ~2 MB and takes ~1s, so it runs after the prediction
 * rather than blocking it.
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

type CallNode = { input?: string; output?: string; to?: string; calls?: CallNode[] }

/** [channels][height][width] */
export type FeatureMaps = number[][][]

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
}

const decode3D = (hex: string): FeatureMaps =>
  (decodeAbiParameters(parseAbiParameters("int256[][][]"), hex as `0x${string}`)[0] as bigint[][][]).map((c) =>
    c.map((row) => row.map(Number))
  )

const decode1D = (hex: string): number[] =>
  (decodeAbiParameters(parseAbiParameters("int256[]"), hex as `0x${string}`)[0] as bigint[]).map(Number)

export async function traceInference(
  client: PublicClient,
  tokenId: bigint,
  grid: number[][]
): Promise<InferenceTrace> {
  const data = encodeFunctionData({
    abi: MNIST_NFT_ABI,
    functionName: "inference",
    args: [tokenId, grid.map((row) => row.map((v) => BigInt(v)))],
  })

  const started = performance.now()
  const result = (await client.request({
    method: "debug_traceCall" as any,
    params: [
      // The call needs headroom; inference alone burns ~60M gas.
      { to: CONTRACT_ADDRESS, data, gas: "0x5F5E100" },
      "latest",
      { tracer: "callTracer" },
    ] as any,
  })) as CallNode
  const elapsedMs = Math.round(performance.now() - started)

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
  for (const [name, sel] of Object.entries(SEL)) {
    const n = children.filter((c) => selectorOf(c) === sel).length
    if (n) callCounts[name] = n
  }

  return {
    conv1: decode3D(convs[0].output!),
    pool1: decode3D(pools[0].output!),
    conv2: decode3D(convs[1].output!),
    pool2: decode3D(pools[1].output!),
    flatten: decode1D(flat.output!),
    logits: decode1D(fc.output!),
    prediction: Number(
      decodeAbiParameters(parseAbiParameters("uint256"), argmax.output! as `0x${string}`)[0]
    ),
    callCounts,
    totalCalls: children.length,
    traceBytes: JSON.stringify(result).length,
    elapsedMs,
  }
}
