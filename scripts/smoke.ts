/**
 * Exercise a deployed MNISTPacked through the same read path as the web app.
 * No transaction is sent and no funds are required.
 *
 *   npx tsx scripts/smoke.ts --target sepolia
 */
import { readFileSync } from "node:fs"

import { runInference } from "../lib/trace.js"
import { arg, makeClients, type Target } from "./common.js"

if (process.env.PRIVATE_KEY === undefined) process.loadEnvFile(".env")

const target = (arg("target") ?? "anvil") as Target
const deploymentPath = arg("deployment") ?? `deployments.${target}.json`
const fixturePath = arg("fixture") ?? "fixtures/verify.json"
const sample = Number(arg("sample") ?? "0")

async function main() {
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"))
  const contract = deployment.contracts.MNISTPacked as `0x${string}` | undefined
  const tokenId = BigInt(deployment.tokenIds?.MNISTPacked ?? "1")
  if (!contract) throw new Error(`${deploymentPath} has no MNISTPacked address`)

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"))
  const image = fixture.images[sample] as number[][] | undefined
  const expected = fixture.simPredictions[sample] as number | undefined
  if (!image || expected === undefined) throw new Error(`fixture has no sample ${sample}`)

  const { chain, publicClient } = makeClients(target)
  const code = await publicClient.getCode({ address: contract })
  if (!code || code === "0x") throw new Error(`no contract code at ${contract}`)

  console.log(`network:  ${chain.name} (chainId ${chain.id})`)
  console.log(`contract: ${contract}`)
  console.log(`token:    ${tokenId}`)
  console.log(`sample:   ${sample}, expected ${expected}`)

  const run = await runInference(publicClient as any, contract, tokenId, image)
  if (run.prediction !== expected) {
    throw new Error(`prediction mismatch: chain ${run.prediction}, simulator ${expected}`)
  }

  const shape = (m: number[][][]) => `${m.length}x${m[0]?.length ?? 0}x${m[0]?.[0]?.length ?? 0}`
  console.log(`prediction ${run.prediction} in ${run.elapsedMs} ms`)
  console.log(`logits:   ${run.logits.length}`)
  console.log(`features: conv1 ${shape(run.conv1)}, pool1 ${shape(run.pool1)}, conv2 ${shape(run.conv2)}, pool2 ${shape(run.pool2)}`)
  console.log(`gas:      ${run.gasTotal ?? "unavailable"}, ${run.stages.length} measured stages`)
  console.log(`block:    ${run.blockNumber} (gas limit ${run.blockGasLimit})`)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exit(1)
})
