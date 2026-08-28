/**
 * How much of a convolution's data parallelism can an EVM contract use?
 *
 * Compiles contracts/ConvBench.sol, injects it into an `eth_call` state
 * override on the configured chain, and runs conv1 and conv2 twice each: once
 * in the shape the deployed Convolution2D uses (one int256 per activation) and
 * once with eight activations packed into every 256-bit word. Both read the
 * real weights out of the deployed model's storage and are checked against each
 * other by checksum, so a faster number can never be a wrong one.
 *
 * Gas is found by bisecting the eth_call gas field, not by eth_estimateGas --
 * public endpoints ignore state overrides on estimateGas.
 *
 * Nothing is deployed and nothing is spent.
 *
 *   npm i -D solc@0.8.28
 *   node scripts/bench-conv.mjs [rpcUrl] [contractAddress]
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import {
  encodeFunctionData, decodeFunctionResult, keccak256, encodeAbiParameters, parseAbiParameters,
} from "viem"

const RPC = process.argv[2] || process.env.NEXT_PUBLIC_RPC_URL_143 || "https://rpc.monad.xyz"
const REGISTRY = (process.argv[3] || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_143 ||
  JSON.parse(fs.readFileSync("deployments.monad.json", "utf8")).contracts.MNISTNFT).toLowerCase()
/** Any address with no code on the target chain; the override puts the bench there. */
const BENCH = "0x000000000000000000000000000000000000be0c"

// ---------------------------------------------------------------- compile

const require = createRequire(import.meta.url)
let solc
try {
  solc = require("solc")
} catch {
  console.error("This script needs the Solidity compiler: npm i -D solc@0.8.28")
  process.exit(1)
}
const SOURCE = path.join("model", "scripts_for_contracts_and_test", "contracts", "ConvBench.sol")
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "ConvBench.sol": { content: fs.readFileSync(SOURCE, "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // The naive convolution runs out of stack slots without it.
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
  },
})))
for (const e of compiled.errors ?? []) {
  if (e.severity === "error") { console.error(e.formattedMessage); process.exit(1) }
}
const { abi, evm } = compiled.contracts["ConvBench.sol"].ConvBench
const code = "0x" + evm.deployedBytecode.object

// ---------------------------------------------------------------- chain

const rpc = async (method, params) => {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return res.json()
}
const hex32 = (n) => `0x${n.toString(16).padStart(64, "0")}`
const at = async (slot) => (await rpc("eth_getStorageAt", [REGISTRY, hex32(slot), "latest"])).result
const toInt8 = (b) => (b >= 128n ? b - 256n : b)
const toInt256 = (v) => (v >= 1n << 255n ? v - (1n << 256n) : v)

/** Model params live at keccak256(tokenId . 9); see lib/model-registry.ts. */
const base = BigInt(keccak256(
  encodeAbiParameters(parseAbiParameters("uint256, uint256"), [1n, 9n])))

async function packedWeights(slotIndex, count) {
  const words = []
  const length = Number(BigInt(await at(base + BigInt(slotIndex))))
  const start = BigInt(keccak256(hex32(base + BigInt(slotIndex))))
  for (let i = 0; i < length; i++) words.push(BigInt(await at(start + BigInt(i))))
  // 32 int8 per word, least-significant byte first -- lib/pack.ts writes them.
  return Array.from({ length: count }, (_, i) =>
    Number(toInt8((words[Math.floor(i / 32)] >> BigInt((i % 32) * 8)) & 0xffn)))
}
async function biases(slotIndex, count) {
  const start = BigInt(keccak256(hex32(base + BigInt(slotIndex))))
  const out = []
  for (let i = 0; i < count; i++) out.push(toInt256(BigInt(await at(start + BigInt(i)))))
  return out
}

const conv1Flat = await packedWeights(1, 27)
const conv2Flat = await packedWeights(2, 162)
const conv1Bias = await biases(4, 3)
const conv2Bias = await biases(5, 6)

const k1 = Array.from({ length: 3 }, (_, oc) =>
  Array.from({ length: 3 }, (_, ky) =>
    Array.from({ length: 3 }, (_, kx) => BigInt(conv1Flat[oc * 9 + ky * 3 + kx]))))
const k2 = Array.from({ length: 6 }, (_, oc) =>
  Array.from({ length: 3 }, (_, ic) =>
    Array.from({ length: 3 }, (_, ky) =>
      Array.from({ length: 3 }, (_, kx) => BigInt(conv2Flat[oc * 27 + ic * 9 + ky * 3 + kx])))))

// ---------------------------------------------------------------- input

/** A vertical bar, so conv2's input is real activations rather than noise. */
const image = Array.from({ length: 28 }, (_, y) =>
  Array.from({ length: 28 }, (_, x) => (x >= 12 && x <= 15 && y >= 5 && y <= 22 ? 255n : 0n)))

const conv1Out = Array.from({ length: 3 }, (_, oc) =>
  Array.from({ length: 28 }, (_, y) => Array.from({ length: 28 }, (_, x) => {
    let acc = conv1Bias[oc]
    for (let ky = 0; ky < 3; ky++) {
      for (let kx = 0; kx < 3; kx++) {
        const iy = y + ky - 1
        const ix = x + kx - 1
        if (iy < 0 || iy >= 28 || ix < 0 || ix >= 28) continue
        acc += image[iy][ix] * k1[oc][ky][kx]
      }
    }
    return acc > 0n ? acc : 0n
  })))
const pool1 = conv1Out.map((channel) => Array.from({ length: 14 }, (_, y) =>
  Array.from({ length: 14 }, (_, x) => {
    let max = channel[y * 2][x * 2]
    for (const [dy, dx] of [[0, 1], [1, 0], [1, 1]]) {
      const v = channel[y * 2 + dy][x * 2 + dx]
      if (v > max) max = v
    }
    return max
  })))

/** Row-major, eight 32-bit lanes per word. Lane width is what bounds the model. */
function pack(rows, width) {
  const words = []
  for (const row of rows) {
    for (let j = 0; j * 8 < width; j++) {
      let word = 0n
      for (let i = 0; i < 8; i++) {
        const x = j * 8 + i
        if (x < width) word |= row[x] << BigInt(i * 32)
      }
      words.push(word)
    }
  }
  return words
}
const packed1 = pack(image, 28)
const packed2 = pack(pool1.flat(), 14)

const peak = pool1.flat(2).reduce((a, b) => (b > a ? b : a), 0n)
console.log(`RPC       ${RPC}`)
console.log(`registry  ${REGISTRY}`)
console.log(`largest conv2 input activation ${peak} — 32-bit lanes leave ` +
  `${(2n ** 32n) / (peak * 127n * 27n)}x headroom before a lane could carry into its neighbour\n`)

// ---------------------------------------------------------------- measure

const overrides = { [BENCH]: { code } }
const call = (data, gas) =>
  rpc("eth_call", [{ to: BENCH, data, gas: `0x${gas.toString(16)}` }, "latest", overrides])

/** Smallest gas budget the call completes in, to 1,000 gas. */
async function gasNeeded(data, hi) {
  let lo = 30_000
  if (!("result" in (await call(data, hi)))) return null
  while (hi - lo > 1_000) {
    const mid = Math.floor((lo + hi) / 2)
    if ("result" in (await call(data, mid))) hi = mid
    else lo = mid
  }
  return hi
}

const CEILING = 140_000_000
const cases = [
  ["conv1", "naive", "convNaive", [image, k1, conv1Bias], 3 * 28 * 28 * 9],
  ["conv1", "packed", "convPacked", [packed1, k1, conv1Bias], 3 * 28 * 28 * 9],
  ["conv2", "naive", "conv2Naive", [pool1, k2, conv2Bias], 6 * 14 * 14 * 27],
  ["conv2", "packed", "conv2Packed", [packed2, k2, conv2Bias], 6 * 14 * 14 * 27],
]

const results = {}
for (const [layer, kind, fn, args, macs] of cases) {
  const data = encodeFunctionData({ abi, functionName: fn, args })
  const res = await call(data, CEILING)
  if (!res.result) {
    console.log(`${layer} ${kind}: failed — ${res.error?.message ?? "no result"}`)
    continue
  }
  const checksum = decodeFunctionResult({ abi, functionName: fn, data: res.result })
  const gas = await gasNeeded(data, CEILING)
  results[`${layer}.${kind}`] = { checksum, gas }
  console.log(
    `${layer} ${kind.padEnd(7)} checksum ${String(checksum).padStart(12)}   ` +
    `${gas.toLocaleString().padStart(11)} gas   ${(gas / macs).toFixed(1).padStart(7)} gas/MAC`
  )
}

console.log()
let failed = false
for (const layer of ["conv1", "conv2"]) {
  const naive = results[`${layer}.naive`]
  const packed = results[`${layer}.packed`]
  if (!naive || !packed) continue
  const same = naive.checksum === packed.checksum
  if (!same) failed = true
  console.log(
    `${layer}: ${same ? "checksums match" : "CHECKSUMS DIFFER — the packed kernel is wrong"}   ` +
    `${naive.gas.toLocaleString()} -> ${packed.gas.toLocaleString()} gas   ` +
    `${(naive.gas / packed.gas).toFixed(1)}x`
  )
}
process.exit(failed ? 1 : 0)
