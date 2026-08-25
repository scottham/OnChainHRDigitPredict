/**
 * Run on-chain inference against an already-deployed MNISTNFT and compare with
 * the offline simulator's predictions.
 *
 * The simulator is only trusted where it agrees with real bytecode, so this is
 * the check that lets the fast numpy path stand in for chain calls.
 *
 * Usage:
 *   npx tsx scripts/verify.ts --target anvil --fixture fixtures/verify.json
 */
import { readFileSync, existsSync } from "node:fs"
import { loadArtifact, makeClients, toBigIntDeep, type Target } from "./common.js"

if (existsSync(".env")) process.loadEnvFile(".env")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const target = (arg("target") ?? "anvil") as Target
const fixturePath = arg("fixture") ?? "fixtures/verify.json"
const deploymentPath = arg("deployment") ?? `deployments.${target}.json`

const { chain, publicClient } = makeClients(target)

async function main() {
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"))
  const address = deployment.contracts.MNISTNFT as `0x${string}`
  const tokenId = BigInt(deployment.tokenId)
  const { abi } = loadArtifact("MNISTNFT")

  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
    images: number[][][]
    labels: number[]
    simPredictions: number[]
  }
  const n = fixture.images.length

  console.log(`network:  ${chain.name} (chainId ${chain.id})`)
  console.log(`contract: ${address}  tokenId ${tokenId}`)
  console.log(`fixture:  ${fixturePath} (${n} images)\n`)

  let matchSim = 0
  let matchLabel = 0
  const mismatches: string[] = []
  const timings: number[] = []

  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    const result = (await publicClient.readContract({
      address, abi, functionName: "inference",
      args: [tokenId, toBigIntDeep(fixture.images[i])],
    })) as bigint
    timings.push(performance.now() - t0)

    const onChain = Number(result)
    if (onChain === fixture.simPredictions[i]) matchSim++
    else mismatches.push(`  image ${i}: chain=${onChain} sim=${fixture.simPredictions[i]} label=${fixture.labels[i]}`)
    if (onChain === fixture.labels[i]) matchLabel++

    if ((i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${n}\r`)
  }

  timings.sort((a, b) => a - b)
  const median = timings[Math.floor(timings.length / 2)]

  console.log(`chain vs simulator: ${matchSim}/${n}`)
  if (mismatches.length) {
    console.log(mismatches.slice(0, 10).join("\n"))
    console.log(`\n*** SIMULATOR IS WRONG -- fix solidity_sim.py, the chain is authoritative ***`)
  } else {
    console.log(`  EXACT MATCH -- simulator is a faithful replica`)
  }
  console.log(`chain vs labels:    ${matchLabel}/${n} (${((100 * matchLabel) / n).toFixed(2)}%)`)
  console.log(`inference latency:  median ${median.toFixed(0)}ms, min ${timings[0].toFixed(0)}ms, max ${timings[n - 1].toFixed(0)}ms`)

  if (matchSim !== n) process.exit(1)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
