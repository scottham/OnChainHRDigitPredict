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

import { NETWORKS, WALLET_CHAINS, rpcFor } from "./networks"

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
 * Every chain a wallet may be on, not just the ones with a contract.
 *
 * NETWORKS can be empty or short -- a chain is listed there only once
 * MNISTPacked is deployed on it. WALLET_CHAINS also includes supported deploy
 * targets so a wallet connected to one can be named and safely gated. It keeps
 * chains[0] defined, which createConfig dereferences as it builds.
 */
const chains: readonly [Chain, ...Chain[]] = WALLET_CHAINS

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: Object.fromEntries(
    chains.map((c) => [c.id, http(NETWORKS.find((n) => n.chain.id === c.id)?.rpcUrl ?? rpcFor(c))])
  ),
  ssr: true,
  /**
   * Multicall batching must stay off.
   *
   * wagmi enables it by default on any chain with a Multicall3 deployment, and
   * The prediction is intentionally one direct eth_call on every chain. Keeping
   * it out of Multicall3 avoids the 63/64 forwarding rule and makes RPC gas caps
   * and failures observable instead of wrapped in aggregate3's success flag.
   */
  batch: { multicall: false },
})
