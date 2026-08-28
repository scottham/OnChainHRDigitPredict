import type { Chain } from "viem"
import { monad, monadTestnet } from "viem/chains"
import { defineChain } from "viem"

import monadDeployment from "../deployments.monad.json"
import monadTestnetDeployment from "../deployments.monadTestnet.json"

/**
 * Every network the app can be pointed at, with the contract that holds the
 * models on each. The user picks one at runtime; nothing here is baked in at
 * build time beyond the addresses themselves.
 *
 * A network is only listed if it has a contract address -- from an env var, or
 * failing that from this repo's own deployment record -- so the selector can
 * never offer a chain where there is nothing to run.
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

/**
 * The registries this repo deployed, read from the deployment records rather
 * than repeated here, so there is one address per chain and not two that can
 * disagree.
 *
 * They are the default because a build is not the place to learn the app was
 * never configured: a checkout with no .env, or a host whose variables still
 * carry the old NEXT_PUBLIC_MONADTESTNET_* names, gets the live contracts
 * instead of an empty chain list. An env var for the same chain wins.
 *
 * MNISTPacked only. The app speaks its ABI -- activations(), runTo() -- which
 * MNISTNFT does not have, so a chain where only the old contract is deployed
 * is left off the list rather than offered and then failing on the first
 * prediction. Deploy and mint there, and it appears.
 */
const DEPLOYED: Record<number, string | undefined> = {
  [monadDeployment.chainId]: (monadDeployment.contracts as Record<string, string>).MNISTPacked,
  [monadTestnetDeployment.chainId]: (monadTestnetDeployment.contracts as Record<string, string>)
    .MNISTPacked,
}

function build(chain: Chain, contract: string | undefined, rpc: string | undefined, isMainnet = false) {
  const address = contract?.trim() || DEPLOYED[chain.id]
  if (!isAddress(address)) return null
  return {
    chain,
    rpcUrl: rpc || chain.rpcUrls.default.http[0],
    contract: address,
    isMainnet,
  } satisfies Network
}

export const NETWORKS: Network[] = [
  build(monad, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_143, process.env.NEXT_PUBLIC_RPC_URL_143, true),
  build(monadTestnet, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_10143, process.env.NEXT_PUBLIC_RPC_URL_10143),
  build(anvil, process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_31337, process.env.NEXT_PUBLIC_RPC_URL_31337),
].filter((n): n is Network => n !== null)

if (NETWORKS.length === 0) {
  // Better a loud warning at import than a page that silently reads nothing.
  console.warn("No networks configured: set NEXT_PUBLIC_CONTRACT_ADDRESS_<chainId> in .env")
}

/**
 * A chain to hand wagmi when NETWORKS is empty. wagmi reads chains[0] while
 * building its config, so an empty list is not an app that shows a warning --
 * it is a TypeError during prerender that fails the build. Nothing reads a
 * contract off this: NETWORKS stays empty and the page renders its
 * unconfigured state.
 */
export const FALLBACK_CHAIN: Chain = monad

/**
 * Chains a wallet may be connected to, whether or not a contract is deployed
 * on them.
 *
 * NETWORKS is what the app can *read* -- a chain with no MNISTPacked is not
 * offered there. But /deploy exists precisely to put one on a chain that has
 * none, so wagmi has to know the chain before there is anything on it,
 * otherwise the wallet connects and no client can be built for it.
 */
export const WALLET_CHAINS: readonly [Chain, ...Chain[]] = [
  monad,
  monadTestnet,
  // Anvil only when this run was pointed at a local node. It is a development
  // chain: offering it in a real wallet's network list is noise at best, and an
  // invitation to switch to a chain that is not running at worst.
  ...(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_31337 || process.env.NEXT_PUBLIC_RPC_URL_31337
    ? [anvil]
    : []),
]

export function chainFor(chainId: number | undefined): Chain | undefined {
  return WALLET_CHAINS.find((c) => c.id === chainId)
}

export function rpcFor(chain: Chain): string {
  const override = {
    [monad.id]: process.env.NEXT_PUBLIC_RPC_URL_143,
    [monadTestnet.id]: process.env.NEXT_PUBLIC_RPC_URL_10143,
    [anvil.id]: process.env.NEXT_PUBLIC_RPC_URL_31337,
  }[chain.id]
  return override || chain.rpcUrls.default.http[0]
}

/** Explorer links for a chain, with or without a deployment on it. */
export function explorerAddressOn(chain: Chain | undefined, address: string) {
  const url = chain?.blockExplorers?.default.url
  return url ? `${url}/address/${address}` : null
}

export function explorerTxOn(chain: Chain | undefined, hash: string) {
  const url = chain?.blockExplorers?.default.url
  return url ? `${url}/tx/${hash}` : null
}

export const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || NETWORKS[0]?.chain.id || monad.id
)

export function networkFor(chainId: number): Network | undefined {
  return NETWORKS.find((n) => n.chain.id === chainId)
}

/**
 * The network to read, given the chain the user picked: that chain if it is
 * configured, otherwise the first one that is.
 *
 * Undefined when nothing at all is configured. That is a real state -- a
 * checkout whose deployment records name no address, an env var set to a
 * non-address -- and callers have to render it rather than dereference it.
 */
export function activeNetwork(chainId: number): Network | undefined {
  return networkFor(chainId) ?? NETWORKS[0]
}

/** True when this chain is known but has no contract -- /deploy's job. */
export function isUndeployed(chainId: number): boolean {
  return !networkFor(chainId) && WALLET_CHAINS.some((c) => c.id === chainId)
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

/**
 * A chain's name, whether or not anything is deployed on it.
 *
 * Reading this out of NETWORKS was wrong the moment a chain could be known but
 * undeployed: the wallet-mismatch banner then named one side and printed a bare
 * number for the other.
 */
export function chainName(id: number): string {
  return WALLET_CHAINS.find((c) => c.id === id)?.name ?? `chainId ${id}`
}
