/**
 * Deploy the contracts. Minting is a separate step -- see scripts/mint.ts.
 *
 * Convolution2D and FullyConnectedLayer are stateless pure-function contracts,
 * so an existing pair can be reused when only MNISTNFT needs redeploying.
 *
 * Usage:
 *   npx tsx scripts/deploy.ts --target anvil
 *   npx tsx scripts/deploy.ts --target monadTestnet --conv 0x.. --fc 0x..
 */
import { writeFileSync, existsSync } from "node:fs"
import { formatEther, type Address } from "viem"
import { loadArtifact, makeClients, computeFees, arg, type Fees, type Target } from "./common.js"

if (existsSync(".env")) process.loadEnvFile(".env")

const target = (arg("target") ?? "anvil") as Target
const outPath = arg("out") ?? `deployments.${target}.json`
const reuseConv = arg("conv") as Address | undefined
const reuseFc = arg("fc") as Address | undefined

const { chain, account, publicClient, walletClient } = makeClients(target)

let fees: Fees

async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const { abi, bytecode } = loadArtifact(name)
  const hash = await walletClient.deployContract({ abi, bytecode, args, chain, account, ...fees })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`${name} deployment reverted (${hash})`)
  console.log(`  ${name.padEnd(20)} ${receipt.contractAddress}  (gas ${receipt.gasUsed})`)
  return receipt.contractAddress!
}

async function main() {
  console.log(`target:   ${chain.name} (chainId ${chain.id})`)
  console.log(`deployer: ${account.address}`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`balance:  ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)
  if (balance === 0n) throw new Error("deployer has zero balance -- fund it before deploying")

  fees = await computeFees(publicClient)
  console.log(`maxFee:   ${Number(fees.maxFeePerGas) / 1e9} gwei\n`)

  console.log(`deploying...`)
  const conv2d = reuseConv ?? (await deploy("Convolution2D"))
  if (reuseConv) console.log(`  Convolution2D        ${conv2d}  (reused)`)
  const fc = reuseFc ?? (await deploy("FullyConnectedLayer"))
  if (reuseFc) console.log(`  FullyConnectedLayer  ${fc}  (reused)`)
  const mnist = await deploy("MNISTNFT", [conv2d, fc])

  const deployment = {
    chainId: chain.id,
    network: chain.name,
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: { Convolution2D: conv2d, FullyConnectedLayer: fc, MNISTNFT: mnist },
    tokenId: null as string | null,
  }
  writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n")
  console.log(`\nwrote ${outPath}`)
  console.log(`next: npx tsx scripts/mint.ts --target ${target} --params <params.json>`)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
