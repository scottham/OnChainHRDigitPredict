"use client"

import { useRouter } from "next/navigation"
import { useAccount, useSwitchChain } from "wagmi"
import { Globe } from "lucide-react"

import { NETWORKS, WALLET_CHAINS, networkFor, type Network } from "@/lib/networks"
import { useT } from "@/lib/i18n"

/**
 * Which network the app reads from.
 *
 * Every chain the app knows is listed, not only the ones with a contract. A
 * list that hides the undeployed ones disappears entirely the moment there is
 * one deployment left, and the wallet's own chain switcher -- which looks the
 * same and sits beside it -- is then the only thing that responds to a click,
 * silently switching the wallet instead of the app. Picking a chain with
 * nothing on it goes to /deploy, which is the only useful answer.
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
  /** Undefined when no chain has a contract at all. */
  active: Network | undefined
  onChange: (chainId: number) => void
}) {
  const t = useT()
  const router = useRouter()
  const { isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  if (WALLET_CHAINS.length < 2 && NETWORKS.length < 2) return null

  return (
    <label className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-2.5 py-1.5 backdrop-blur">
      <Globe className="h-3.5 w-3.5 shrink-0 text-violet-400" />
      <span className="sr-only">{t.picker.label}</span>
      <select
        value={active?.chain.id ?? ""}
        onChange={(e) => {
          const id = Number(e.target.value)
          // Nothing to read there yet -- send them to the page that fixes that
          // rather than switching to a chain the app cannot answer from.
          if (!networkFor(id)) {
            router.push("/deploy")
            return
          }
          onChange(id)
          if (isConnected) switchChain?.({ chainId: id })
        }}
        className="cursor-pointer bg-transparent text-xs outline-none"
      >
        {!active && (
          <option value="" className="bg-background">
            {t.picker.none}
          </option>
        )}
        {WALLET_CHAINS.map((c) => (
          <option key={c.id} value={c.id} className="bg-background">
            {c.name}
            {networkFor(c.id) ? "" : ` · ${t.picker.undeployed}`}
          </option>
        ))}
      </select>
    </label>
  )
}
