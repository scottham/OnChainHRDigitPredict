/**
 * Fee cap for a transaction.
 *
 * Monad charges `gas_bid * gas_limit` -- the declared limit, not the gas
 * actually used -- so a fat fee cap and a fat gas limit both cost real money.
 * viem's default 1.2x base-fee multiplier would inflate every transaction by
 * 20% for nothing. Monad's base fee has been a flat 100 gwei, so a 5% cushion
 * is ample.
 *
 * Shared by scripts/common.ts and the browser, because a transaction sent from
 * the page should cost what the same transaction costs from a script.
 */
export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

export async function computeFees(client: {
  chain?: { id: number }
  getBlock: (a: { blockTag: "latest" }) => Promise<{ baseFeePerGas: bigint | null }>
  estimateFeesPerGas?: () => Promise<{
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
    gasPrice?: bigint
  }>
}): Promise<Fees> {
  const block = await client.getBlock({ blockTag: "latest" })
  const base = block.baseFeePerGas ?? 0n

  // Monad charges the declared bid times the declared gas limit. Preserve the
  // deliberately tight cap used by the existing deployments.
  if (client.chain?.id === 143 || client.chain?.id === 10143) {
    return {
      maxFeePerGas: (base * 105n) / 100n + 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    }
  }

  // Ethereum and OP Stack fee markets differ materially from Monad. Let the
  // connected node account for the chain's current base fee and tip instead of
  // carrying Monad's hard-coded 1 gwei priority fee onto every network.
  const estimate = await client.estimateFeesPerGas?.()
  if (estimate?.maxFeePerGas !== undefined) {
    return {
      maxFeePerGas: estimate.maxFeePerGas,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas ?? 0n,
    }
  }

  // Legacy/non-EIP-1559 fallback. Both fields are accepted by the existing
  // viem call sites; this branch is mainly for unusual local RPCs.
  const gasPrice = estimate?.gasPrice ?? base
  return {
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: 0n,
  }
}

/** Gas limit to declare for a transaction estimated at `estimate`. */
export const GAS_PAD = 115n
export const padGas = (estimate: bigint) => (estimate * GAS_PAD) / 100n
