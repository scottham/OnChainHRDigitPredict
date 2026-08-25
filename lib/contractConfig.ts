import { monadTestnet } from "viem/chains"
import { MNIST_NFT_ABI } from "./abi"

export { MNIST_NFT_ABI }

export const CHAIN = monadTestnet

/** Overridable so a fork or a private node can be pointed at without a rebuild. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_MONADTESTNET_RPC_URL || monadTestnet.rpcUrls.default.http[0]

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_MONADTESTNET_CONTRACT_ADDRESS ||
  "") as `0x${string}`

/** Token whose weights the demo runs by default. */
export const DEFAULT_TOKEN_ID = BigInt(process.env.NEXT_PUBLIC_DEFAULT_TOKEN_ID || "1")

export const EXPLORER_URL = monadTestnet.blockExplorers?.default.url ?? ""

export function explorerAddress(address: string) {
  return `${EXPLORER_URL}/address/${address}`
}

export const IS_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS)
