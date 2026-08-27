import type { Chain } from "viem"
import { monad, monadTestnet } from "viem/chains"
import { defineChain } from "viem"

/**
 * Every network the app can be pointed at, with the contract that holds the
 * models on each. The user picks one at runtime; nothing here is baked in at
 * build time beyond the addresses themselves.
 *
 * A network is only listed if its contract address is configured, so the
 * selector can never offer a chain where there is nothing to run.
 */

export const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
})

export type Network = {
  chain: Chain
  rpcUrl: string
  contract: `0x${string}`
  /** Real funds at stake. */
  isMainnet: boolean
}

const isAddress = (v: string | undefined): v is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(v ?? "")

function build(chain: Chain, contract: string | undefined, rpc: string | undefined, isMainnet = false) {
  if (!isAddress(contract)) return null
  return {
    chain,
    rpcUrl: rpc || chain.rpcUrls.default.http[0],
    contract,
    isMainnet,
  } satisfies Network
}

export const NETWORKS: Network[] = [
  build(monad, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_143, process.env.NEXT_PUBLIC_RPC_URL_143, true),
  build(monadTestnet, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_10143, process.env.NEXT_PUBLIC_RPC_URL_10143),
  build(anvil, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_31337, process.env.NEXT_PUBLIC_RPC_URL_31337),
].filter((n): n is Network => n !== null)

if (NETWORKS.length === 0) {
  // Better a loud failure at import than a page that silently reads nothing.
  console.warn("No networks configured: set NEXT_PUBLIC_CONTRACT_ADDRESS_<chainId> in .env")
}

export const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || NETWORKS[0]?.chain.id || monad.id
)

export function networkFor(chainId: number): Network | undefined {
  return NETWORKS.find((n) => n.chain.id === chainId)
}

/** Token whose weights the demo runs by default. */
export const DEFAULT_TOKEN_ID = BigInt(process.env.NEXT_PUBLIC_DEFAULT_TOKEN_ID || "1")

export function explorerAddress(network: Network, address: string) {
  const url = network.chain.blockExplorers?.default.url
  return url ? `${url}/address/${address}` : null
}

/** The NFT page for one token -- the model, not the contract that holds it. */
export function explorerToken(network: Network, tokenId: bigint | string) {
  const url = network.chain.blockExplorers?.default.url
  return url ? `${url}/nft/${network.contract}/${tokenId}` : null
}

export function chainName(id: number): string {
  return networkFor(id)?.chain.name ?? (id === 31337 ? "Anvil (local)" : `chainId ${id}`)
}
