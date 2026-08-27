"use client"

import { useAccount, useSwitchChain } from "wagmi"
import { Globe } from "lucide-react"

import { NETWORKS, type Network } from "@/lib/networks"

/**
 * Which network the app reads from.
 *
 * Switching also asks a connected wallet to follow, because a page reading one
 * chain while the wallet sits on another is precisely how a transaction meant
 * for testnet ends up on mainnet. The wallet may refuse or the user may cancel,
 * so the mint gate still checks -- this only removes the need to switch twice.
 */
export default function NetworkPicker({
  active,
  onChange,
}: {
  active: Network
  onChange: (chainId: number) => void
}) {
  const { isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  if (NETWORKS.length < 2) return null

  return (
    <label className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-2.5 py-1.5 backdrop-blur">
      <Globe className="h-3.5 w-3.5 shrink-0 text-violet-400" />
      <span className="sr-only">Network</span>
      <select
        value={active.chain.id}
        onChange={(e) => {
          const id = Number(e.target.value)
          onChange(id)
          if (isConnected) switchChain?.({ chainId: id })
        }}
        className="cursor-pointer bg-transparent text-xs outline-none"
      >
        {NETWORKS.map((n) => (
          <option key={n.chain.id} value={n.chain.id} className="bg-background">
            {n.chain.name}
            {n.isMainnet ? " · mainnet" : ""}
          </option>
        ))}
      </select>
    </label>
  )
}
