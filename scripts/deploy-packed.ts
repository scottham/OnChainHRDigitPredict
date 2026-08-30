/**
 * Deploy the MNISTPacked registry used by the web app. Minting the first model
 * is a separate transaction; see scripts/mint.ts.
 *
 *   npx tsx scripts/deploy-packed.ts --target monadTestnet
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { formatEther, type Address } from "viem"
import { loadArtifact, makeClients, computeFees, padGas, arg, type Target } from "./common.js"

if (existsSync(".env")) process.loadEnvFile(".env")

const target = (arg("target") ?? "anvil") as Target
const outPath = arg("out") ?? `deployments.${target}.json`
const dryRun = process.argv.includes("--dry-run")

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

  const estimate = await publicClient.estimateGas({ account: account.address, data: bytecode })
  const gas = padGas(estimate)
  const reserved = gas * fees.maxFeePerGas
  console.log(`estimate: ${estimate} gas, limit ${gas}`)
  console.log(`reserved: ${formatEther(reserved)} ${chain.nativeCurrency.symbol}`)
  if (balance < reserved) throw new Error("deployer balance is below the reserved deployment fee")
  if (dryRun) {
    console.log("dry-run:  no transaction sent")
    return
  }

  const hash = await walletClient.deployContract({ abi, bytecode, gas, chain, account, ...fees })
  console.log(`tx:       ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`deployment reverted (${hash})`)
  const address = receipt.contractAddress as Address
  console.log(`\nMNISTPacked ${address}  (gas ${receipt.gasUsed})`)

  const record = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : { contracts: {} }
  record.chainId = chain.id
  record.network = chain.name
  record.deployer = account.address
  record.deployedAt = new Date().toISOString()
  record.contracts = { ...(record.contracts ?? {}), MNISTPacked: address }
  record.tokenIds = { ...(record.tokenIds ?? {}) }
  record.transactions = { ...(record.transactions ?? {}), deployment: hash }
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n")
  console.log(`recorded in ${outPath}`)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
