/**
 * Regenerate lib/abi.ts from the forge artifact, so the frontend ABI can never
 * drift from the deployed contract.
 *
 *   npx tsx scripts/gen-abi.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const ARTIFACT = "model/scripts_for_contracts_and_test/out/MNISTPacked.sol/MNISTPacked.json"

// Only what the app actually calls; the full ERC721 surface is noise here.
const KEEP = new Set(["mint", "inference", "logits", "runTo", "activations", "ownerOf", "balanceOf", "name", "symbol"])

const full = JSON.parse(readFileSync(ARTIFACT, "utf-8")).abi
const abi = full.filter(
  (x) => (x.type === "function" && KEEP.has(x.name)) || (x.type === "event" && x.name === "Transfer")
)

writeFileSync(
  "lib/abi.ts",
  "// Generated from forge artifact -- do not edit by hand.\n" +
    "// Regenerate: npx tsx scripts/gen-abi.mjs\n\n" +
    "export const MNIST_ABI = " + JSON.stringify(abi, null, 2) + " as const\n"
)

console.log(`wrote lib/abi.ts with ${abi.length} entries`)
