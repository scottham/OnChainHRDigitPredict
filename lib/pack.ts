/**
 * Pack int8 weights the way MNISTNFT stores them.
 *
 * One 256-bit word holds 32 weights, row-major, least-significant byte first.
 * This has to agree byte for byte with `_at` / `_rebuild4D` / `_rebuild2D` in
 * MNISTNFT.sol -- `scripts/verify.ts` is what proves it does, by running the
 * minted model against the chain.
 *
 * Packing here rather than on-chain is what keeps `mint` sendable from a
 * browser wallet: as `int[]` the same weights are ~108 KB of calldata, past
 * MetaMask's request size limit, and ~1.7M gas of calldata on top.
 */

const WEIGHTS_PER_SLOT = 32

export function packWeights(flat: number[]): bigint[] {
  const words: bigint[] = new Array(Math.ceil(flat.length / WEIGHTS_PER_SLOT)).fill(0n)
  flat.forEach((value, i) => {
    if (!Number.isInteger(value) || value < -128 || value > 127) {
      throw new Error(`weight ${i} is outside int8 range: ${value}`)
    }
    const byte = BigInt(value & 0xff) // two's complement, same as int8 -> uint8
    words[Math.floor(i / WEIGHTS_PER_SLOT)] |= byte << (BigInt(i % WEIGHTS_PER_SLOT) * 8n)
  })
  return words
}

/** [out][in][kh][kw] -> row-major flat list. */
export function flatten4D(kernel: number[][][][]): number[] {
  const flat: number[] = []
  for (const outChannel of kernel)
    for (const inChannel of outChannel) for (const row of inChannel) for (const v of row) flat.push(v)
  return flat
}

/** [out][in] -> row-major flat list. */
export function flatten2D(matrix: number[][]): number[] {
  const flat: number[] = []
  for (const row of matrix) for (const v of row) flat.push(v)
  return flat
}

export type MintArgs = [
  [number, number, number], bigint[], bigint[],
  [number, number, number], bigint[], bigint[],
  [number, number], bigint[], bigint[],
]

/** Turn a params JSON from model/train.py into the arguments `mint` takes. */
export function toMintArgs(params: {
  conv1: number[][][][]
  conv1_bias: number[]
  conv2: number[][][][]
  conv2_bias: number[]
  fc: number[][]
  fc_bias: number[]
}): MintArgs {
  const shape4 = (k: number[][][][]): [number, number, number] => [k.length, k[0].length, k[0][0].length]
  const shape2 = (m: number[][]): [number, number] => [m.length, m[0].length]
  const bias = (b: number[]) => b.map((v) => BigInt(v))

  return [
    shape4(params.conv1), packWeights(flatten4D(params.conv1)), bias(params.conv1_bias),
    shape4(params.conv2), packWeights(flatten4D(params.conv2)), bias(params.conv2_bias),
    shape2(params.fc), packWeights(flatten2D(params.fc)), bias(params.fc_bias),
  ]
}
