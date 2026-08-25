import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createPublicClient, createWalletClient, http, defineChain, type Abi, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const ROOT = resolve(import.meta.dirname, "..")
const FORGE_OUT = resolve(ROOT, "model/scripts_for_contracts_and_test/out")

/** Monad testnet, re-genesised 2025-12-16. */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadExplorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
})

/** Local anvil. Uses anvil's well-known dev account 0 -- a public test key. */
export const anvilChain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
})
export const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

/**
 * Pin fees just above the current base fee.
 *
 * Monad charges `gas_bid * gas_limit` -- the declared limit, not the gas
 * actually used -- so both a fat fee cap and a fat gas limit cost real money.
 * viem's default 1.2x base-fee multiplier would inflate every transaction by
 * 20% for nothing. Monad's base fee has been a flat 100 gwei, so a 5% cushion
 * is ample.
 */
export async function computeFees(publicClient: {
  getBlock: (a: { blockTag: "latest" }) => Promise<{ baseFeePerGas: bigint | null }>
}): Promise<Fees> {
  const block = await publicClient.getBlock({ blockTag: "latest" })
  const base = block.baseFeePerGas ?? 0n
  return {
    maxFeePerGas: (base * 105n) / 100n + 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  }
}

export type Artifact = { abi: Abi; bytecode: Hex }

export function loadArtifact(name: string): Artifact {
  const path = resolve(FORGE_OUT, `${name}.sol/${name}.json`)
  const json = JSON.parse(readFileSync(path, "utf-8"))
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex }
}

/**
 * Recursively turn JSON numbers into BigInt for int256 ABI params.
 *
 * Safe because train.py caps every quantized value below 2^53, so JSON.parse
 * round-trips them without precision loss. quantize() raises if that is ever
 * violated, which is why SCALE is 1e4 rather than the original 1e6.
 */
export function toBigIntDeep(value: unknown): any {
  if (Array.isArray(value)) return value.map(toBigIntDeep)
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`non-integer param: ${value}`)
    if (!Number.isSafeInteger(value)) throw new Error(`param exceeds 2^53: ${value}`)
    return BigInt(value)
  }
  throw new Error(`unexpected param type: ${typeof value}`)
}

export type ModelParams = {
  conv1: bigint[][][][]
  conv1_bias: bigint[]
  conv2: bigint[][][][]
  conv2_bias: bigint[]
  fc: bigint[][]
  fc_bias: bigint[]
}

export function loadParams(path: string): ModelParams {
  const raw = JSON.parse(readFileSync(path, "utf-8"))
  return {
    conv1: toBigIntDeep(raw.conv1),
    conv1_bias: toBigIntDeep(raw.conv1_bias),
    conv2: toBigIntDeep(raw.conv2),
    conv2_bias: toBigIntDeep(raw.conv2_bias),
    fc: toBigIntDeep(raw.fc),
    fc_bias: toBigIntDeep(raw.fc_bias),
  }
}

export type Target = "anvil" | "monadTestnet"

/**
 * Build clients for a target. The testnet key comes from PRIVATE_KEY in .env
 * and is never logged -- only the derived address is printed.
 */
export function makeClients(target: Target) {
  if (target === "anvil") {
    const account = privateKeyToAccount(ANVIL_KEY)
    return {
      chain: anvilChain,
      account,
      publicClient: createPublicClient({ chain: anvilChain, transport: http() }),
      walletClient: createWalletClient({ chain: anvilChain, account, transport: http() }),
    }
  }

  const key = process.env.PRIVATE_KEY
  if (!key) throw new Error("PRIVATE_KEY not set in .env")
  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as Hex
  const account = privateKeyToAccount(normalized)

  const rpc = process.env.NEXT_PUBLIC_MONADTESTNET_RPC_URL || monadTestnet.rpcUrls.default.http[0]
  const chain = { ...monadTestnet, rpcUrls: { default: { http: [rpc] } } }

  return {
    chain,
    account,
    publicClient: createPublicClient({ chain, transport: http(rpc) }),
    walletClient: createWalletClient({ chain, account, transport: http(rpc) }),
  }
}
