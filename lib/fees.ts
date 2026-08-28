/**
 * Fee cap for a Monad transaction.
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
  getBlock: (a: { blockTag: "latest" }) => Promise<{ baseFeePerGas: bigint | null }>
}): Promise<Fees> {
  const block = await client.getBlock({ blockTag: "latest" })
  const base = block.baseFeePerGas ?? 0n
  return {
    maxFeePerGas: (base * 105n) / 100n + 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  }
}

/** Gas limit to declare for a transaction estimated at `estimate`. */
export const GAS_PAD = 115n
export const padGas = (estimate: bigint) => (estimate * GAS_PAD) / 100n
