"use client"

import { connectorsForWallets } from "@rainbow-me/rainbowkit"
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets"
import { createConfig, http } from "wagmi"
import type { Chain } from "viem"

import { FALLBACK_CHAIN, NETWORKS } from "./networks"

/**
 * WalletConnect needs a project id from https://cloud.reown.com. Without one
 * the QR/mobile flow is dropped; injected wallets still work.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""

const wallets = [metaMaskWallet, rabbyWallet, rainbowWallet, injectedWallet]
if (projectId) wallets.splice(3, 0, walletConnectWallet)

/**
 * Connectors are listed explicitly rather than via getDefaultConfig: that pulls
 * in Coinbase's baseAccount connector, whose @coinbase/cdp-sdk dependency fails
 * to resolve @x402/evm and breaks the build. None of it is needed here.
 */
const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "On-Chain Digit Recognition",
  projectId: projectId || "onchain-mnist-demo",
})

/**
 * Every configured network, so the user can switch at runtime and RainbowKit
 * can offer the wallet the matching chain.
 *
 * createConfig reads chains[0] as it builds, so an empty list is a TypeError
 * at import -- during a build that is a failed prerender, not a page saying it
 * is unconfigured. Keep one placeholder chain so the app can render and say so.
 */
const chains = (NETWORKS.length > 0 ? NETWORKS.map((n) => n.chain) : [FALLBACK_CHAIN]) as unknown as readonly [
  Chain,
  ...Chain[],
]

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: Object.fromEntries(chains.map((c) => [c.id, http(NETWORKS.find((n) => n.chain.id === c.id)?.rpcUrl)])),
  ssr: true,
  /**
   * Multicall batching must stay off.
   *
   * wagmi enables it by default on any chain with a Multicall3 deployment, and
   * viem's monadTestnet definition has one. inference() burns ~60M gas, and
   * routed through Multicall3 the 63/64 gas-forwarding rule plus the RPC's
   * eth_call budget starve the inner call. aggregate3 then swallows the
   * failure and reports success=false, which surfaces as a bare revert with no
   * reason -- the call never even reaches the NFT contract.
   */
  batch: { multicall: false },
})
