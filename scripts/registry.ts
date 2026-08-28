/**
 * List every model minted on the configured contract, read straight from
 * storage the same way the app's Model card does.
 *
 *   npx tsx scripts/registry.ts
 */
import { existsSync } from "node:fs"
import { createPublicClient, http } from "viem"
if (existsSync(".env")) process.loadEnvFile(".env")

async function main() {
  // Imported after the env file loads: the network registry reads env at module
  // scope, which Next inlines at build time but Node does not.
  const { describeArchitecture, readTokenCount, readTokenModel } = await import(
    "../lib/model-registry.js"
  )
  const client = createPublicClient({
    transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.monad.xyz"),
  }) as any

  const contract = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`
  const count = await readTokenCount(client, contract)
  console.log(`contract ${contract} on chain ${process.env.NEXT_PUBLIC_CHAIN_ID ?? "?"}`)
  console.log(`tokens minted: ${count}\n`)

  for (let id = 1n; id <= BigInt(count); id++) {
    const m = await readTokenModel(client, contract, id)
    console.log(`token #${id}`)
    console.log(`  owner        ${m.owner}`)
    console.log(`  architecture ${describeArchitecture(m)}`)
    console.log(`  weights      ${m.weights.toLocaleString()} int8 in ${m.words} words`)
    console.log(`  biases       ${m.biases} x int256`)
  }
}
main()
