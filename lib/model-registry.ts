import { encodeAbiParameters, keccak256, parseAbiParameters, type PublicClient } from "viem"

import { MNIST_NFT_ABI } from "./abi"

/**
 * The model *is* the token: every id holds a different set of weights, and the
 * page runs whichever one you pick. So its description has to be read off the
 * chain per token rather than hardcoded to the one model this repo trained.
 *
 * MNISTNFT has no getter for ModelParams, so the shapes come out of storage.
 * Layout from `forge inspect MNISTNFT storage`:
 *
 *   slot 6                    _tokenIds, the mint counter
 *   slot 9                    _tokenModelParams mapping
 *   keccak256(id . 9) + 0     conv1Out,conv1In,conv1K,conv2Out,conv2In,conv2K,
 *                             fcOut,fcIn -- eight uint16 packed into one word,
 *                             least-significant first
 *              + 1, 2, 3      conv1Packed / conv2Packed / fcPacked lengths
 *              + 4, 5, 6      conv1Bias / conv2Bias / fcBias lengths
 */

const TOKEN_COUNTER_SLOT = 6n
const MODEL_PARAMS_SLOT = 9n
const WEIGHTS_PER_WORD = 32

export type TokenModel = {
  tokenId: bigint
  owner: `0x${string}` | null
  /** [outChannels, inChannels, kernel] */
  conv1: [number, number, number]
  conv2: [number, number, number]
  /** [outFeatures, inFeatures] */
  fc: [number, number]
  /** int8 weights, counted from the shapes. */
  weights: number
  /** 256-bit words those weights occupy, read from the stored array lengths. */
  words: number
  biases: number
}

const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`

function modelBaseSlot(tokenId: bigint): bigint {
  return BigInt(
    keccak256(encodeAbiParameters(parseAbiParameters("uint256, uint256"), [tokenId, MODEL_PARAMS_SLOT]))
  )
}

/** How many tokens have been minted. */
export async function readTokenCount(
  client: PublicClient,
  contract: `0x${string}`
): Promise<number> {
  const value = await client.getStorageAt({ address: contract, slot: hex32(TOKEN_COUNTER_SLOT) })
  return Number(BigInt(value ?? "0x0"))
}

export async function readTokenModel(
  client: PublicClient,
  contract: `0x${string}`,
  tokenId: bigint
): Promise<TokenModel> {
  const base = modelBaseSlot(tokenId)
  const at = (offset: bigint) =>
    client.getStorageAt({ address: contract, slot: hex32(base + offset) })

  const [shapeWord, ...lengths] = await Promise.all([
    at(0n),
    at(1n), at(2n), at(3n),
    at(4n), at(5n), at(6n),
  ])

  const packed = BigInt(shapeWord ?? "0x0")
  const field = (i: number) => Number((packed >> BigInt(i * 16)) & 0xffffn)
  const conv1: [number, number, number] = [field(0), field(1), field(2)]
  const conv2: [number, number, number] = [field(3), field(4), field(5)]
  const fc: [number, number] = [field(6), field(7)]

  const len = (i: number) => Number(BigInt(lengths[i] ?? "0x0"))

  const owner = await client
    .readContract({ address: contract, abi: MNIST_NFT_ABI, functionName: "ownerOf", args: [tokenId] })
    .then((a) => a as `0x${string}`)
    .catch(() => null) // reverts for an id that was never minted

  return {
    tokenId,
    owner,
    conv1,
    conv2,
    fc,
    weights: conv1[0] * conv1[1] * conv1[2] ** 2 + conv2[0] * conv2[1] * conv2[2] ** 2 + fc[0] * fc[1],
    words: len(0) + len(1) + len(2),
    biases: len(3) + len(4) + len(5),
  }
}

/** "conv 1→3 3×3 · conv 3→6 3×3 · fc 294→10" */
export function describeArchitecture(model: TokenModel): string {
  const conv = (s: [number, number, number]) => `conv ${s[1]}→${s[0]} ${s[2]}×${s[2]}`
  return `${conv(model.conv1)} · ${conv(model.conv2)} · fc ${model.fc[1]}→${model.fc[0]}`
}

export const WEIGHTS_PER_SLOT = WEIGHTS_PER_WORD
