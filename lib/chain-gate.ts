/**
 * Whether a write is allowed: the chain the app is reading must be the chain
 * the wallet is on.
 *
 * This exists as a pure function because getting it wrong is silent and
 * expensive. The original check compared the wallet against `CHAIN.id`, a
 * constant -- so with the app pointed at a local node and the wallet on Monad
 * testnet it reported "same chain", and the mint went to an address that holds
 * the contract locally and nothing at all on testnet. A transaction to an
 * address with no code does not revert: it succeeds, emits no logs, and mints
 * nothing, which reads as success everywhere a user would look.
 *
 * `nodeChainId` is what the RPC node itself reports, never what the config
 * claims. Null means not yet known, which is not the same as fine.
 */
export type GateReason = "ok" | "disconnected" | "chain-unknown" | "chain-mismatch"

export function mintGate(state: {
  isConnected: boolean
  /** Chain the wallet is on. */
  walletChainId: number | undefined
  /** Chain the RPC node reports, or null while it is still being read. */
  nodeChainId: number | null
}): { allowed: boolean; reason: GateReason } {
  if (!state.isConnected || state.walletChainId === undefined) {
    return { allowed: false, reason: "disconnected" }
  }
  if (state.nodeChainId === null) {
    return { allowed: false, reason: "chain-unknown" }
  }
  if (state.walletChainId !== state.nodeChainId) {
    return { allowed: false, reason: "chain-mismatch" }
  }
  return { allowed: true, reason: "ok" }
}
