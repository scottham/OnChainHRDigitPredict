/**
 * Mint a model NFT: one transaction that uploads the weights.
 *
 * Weights are int8-packed 32-to-a-slot in the contract, so a full model is
 * ~117 storage slots and ~2.3M gas -- small enough that this stays a single
 * call on chains with a per-transaction gas cap.
 *
 * Usage:
 *   npx tsx scripts/mint.ts --target monadTestnet --params model/checkpoints/x.json
 *   npx tsx scripts/mint.ts --target monadTestnet --params x.json --contract MNISTPacked
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { formatEther } from "viem"
import { loadArtifact, makeClients, computeFees, arg, type Target } from "./common.js"
import { toMintArgs } from "../lib/pack.js"

if (existsSync(".env")) process.loadEnvFile(".env")

const target = (arg("target") ?? "anvil") as Target
const paramsPath = arg("params")
const deploymentPath = arg("deployment") ?? `deployments.${target}.json`
const gasPad = BigInt(arg("gas-pad") ?? "115")
const dryRun = process.argv.includes("--dry-run")
/** Both contracts take the same packed calldata, so either can be minted into. */
const contractName = arg("contract") ?? "MNISTNFT"

if (!paramsPath) throw new Error("--params is required")

const { chain, account, publicClient, walletClient } = makeClients(target)

async function main() {
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"))
  const address = deployment.contracts[contractName]
  if (!address) throw new Error(`${deploymentPath} has no ${contractName} address`)
  const { abi } = loadArtifact(contractName)
  // The same packer the browser uses -- verify.ts is what proves the packed
  // layout matches what the contract reads back.
  const args = toMintArgs(JSON.parse(readFileSync(paramsPath!, "utf-8")))

  console.log(`target:   ${chain.name} (chainId ${chain.id})`)
  console.log(`contract: ${contractName} ${address}`)
  console.log(`params:   ${paramsPath}`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`balance:  ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)

  const fees = await computeFees(publicClient)

  const estimate = await publicClient.estimateContractGas({
    address, abi, functionName: "mint", args, account,
  })
  const gas = (estimate * gasPad) / 100n

  // Monad charges on the declared gas limit, not gas used, so an inflated
  // limit costs real money -- keep the pad tight and show what it reserves.
  console.log(`estimate: ${estimate} gas, limit ${gas}`)
  console.log(`reserved: ${formatEther(gas * fees.maxFeePerGas)} ${chain.nativeCurrency.symbol}\n`)
  if (dryRun) {
    console.log("dry-run: no transaction sent")
    return
  }

  const hash = await walletClient.writeContract({
    address, abi, functionName: "mint", args, gas, chain, account, ...fees,
  })
  console.log(`tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`mint reverted (${hash})`)

  // ERC721 Transfer(from, to, tokenId) -- tokenId is the third indexed topic.
  const tokenId = BigInt(receipt.logs[0].topics[3]!)
  const after = await publicClient.getBalance({ address: account.address })

  console.log(`minted tokenId ${tokenId}  (gas used ${receipt.gasUsed})`)
  console.log(`spent:    ${formatEther(balance - after)} ${chain.nativeCurrency.symbol}`)
  console.log(`remaining:${formatEther(after)} ${chain.nativeCurrency.symbol}`)

  if (contractName === "MNISTNFT") deployment.tokenId = tokenId.toString()
  else deployment.tokenIds = { ...(deployment.tokenIds ?? {}), [contractName]: tokenId.toString() }
  deployment.transactions = {
    ...(deployment.transactions ?? {}),
    mint: { ...(deployment.transactions?.mint ?? {}), [contractName]: hash },
  }
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n")
  console.log(
    contractName === "MNISTPacked"
      ? `\nnext: npm run smoke -- --target ${target}`
      : `\nnext: npx tsx scripts/verify.ts --target ${target}`
  )
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
