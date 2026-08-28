/**
 * Deploy MNISTPacked beside an existing MNISTNFT.
 *
 * MNISTPacked has no mint: it reads a model out of MNISTNFT's storage layout,
 * so a fresh deployment holds no model of its own. It is exercised by an
 * eth_call whose state override supplies the minted contract's slots -- see
 * scripts/verify-packed.mjs and scripts/measure-packed.mts.
 *
 *   npx tsx scripts/deploy-packed.ts --target monadTestnet
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { formatEther, type Address } from "viem"
import { loadArtifact, makeClients, computeFees, arg, type Target } from "./common.js"

if (existsSync(".env")) process.loadEnvFile(".env")

const target = (arg("target") ?? "anvil") as Target
const outPath = arg("out") ?? `deployments.${target}.json`

const { chain, account, publicClient, walletClient } = makeClients(target)

async function main() {
  console.log(`target:   ${chain.name} (chainId ${chain.id})`)
  console.log(`deployer: ${account.address}`)
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`balance:  ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)
  if (balance === 0n) throw new Error("deployer has zero balance -- fund it before deploying")

  const fees = await computeFees(publicClient)
  const { abi, bytecode } = loadArtifact("MNISTPacked")
  console.log(`initcode: ${bytecode.length / 2 - 1} bytes`)

  const hash = await walletClient.deployContract({ abi, bytecode, chain, account, ...fees })
  console.log(`tx:       ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`deployment reverted (${hash})`)
  const address = receipt.contractAddress as Address
  console.log(`\nMNISTPacked ${address}  (gas ${receipt.gasUsed})`)

  if (existsSync(outPath)) {
    const record = JSON.parse(readFileSync(outPath, "utf8"))
    record.contracts.MNISTPacked = address
    writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n")
    console.log(`recorded in ${outPath}`)
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
