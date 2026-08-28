/**
 * Write what /deploy needs into public/, so the page can deploy and mint from a
 * browser wallet without any of it being bundled into the app's JavaScript.
 *
 *   npx tsx scripts/gen-deploy-assets.mjs [paramsPath]
 *
 * Both files are fetched on demand by app/deploy/page.tsx. Regenerate after
 * `forge build`, or the page will deploy the previous bytecode.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { basename } from "node:path"

const ARTIFACT = "model/scripts_for_contracts_and_test/out/MNISTPacked.sol/MNISTPacked.json"
const params = process.argv[2] ?? "model/checkpoints/best_model_epoch_21_acc_98.09.json"

mkdirSync("public", { recursive: true })

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf-8"))
const bytecode = artifact.bytecode.object
if (!/^0x[0-9a-fA-F]+$/.test(bytecode)) throw new Error("artifact has no creation bytecode")
writeFileSync("public/MNISTPacked.bytecode.txt", bytecode + "\n")

const model = JSON.parse(readFileSync(params, "utf-8"))
for (const key of ["conv1", "conv1_bias", "conv2", "conv2_bias", "fc", "fc_bias"]) {
  if (!(key in model)) throw new Error(`${params} has no ${key}`)
}
writeFileSync("public/model-params.json", JSON.stringify(model))

console.log(`public/MNISTPacked.bytecode.txt  ${bytecode.length / 2 - 1} bytes of init code`)
console.log(`public/model-params.json         from ${basename(params)}`)
