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

import { CHAIN, RPC_URL } from "./contractConfig"

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

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  transports: { [CHAIN.id]: http(RPC_URL) },
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
