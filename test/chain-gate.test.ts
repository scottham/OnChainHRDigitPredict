/**
 * The mint gate, including a regression for the bug that sent a real testnet
 * transaction to an anvil address: wallet on 10143, app reading 31337.
 *
 *   npx tsx test/chain-gate.test.ts
 */
import assert from "node:assert/strict"
import { mintGate } from "../lib/chain-gate.js"

const cases: [string, Parameters<typeof mintGate>[0], boolean, string][] = [
  ["no wallet", { isConnected: false, walletChainId: undefined, nodeChainId: 10143 }, false, "disconnected"],
  ["connected, chain not read yet", { isConnected: true, walletChainId: 10143, nodeChainId: null }, false, "chain-unknown"],
  ["wallet on mainnet, app on testnet", { isConnected: true, walletChainId: 1, nodeChainId: 10143 }, false, "chain-mismatch"],
  ["wallet on testnet, app on anvil", { isConnected: true, walletChainId: 10143, nodeChainId: 31337 }, false, "chain-mismatch"],
  ["wallet on anvil, app on testnet", { isConnected: true, walletChainId: 31337, nodeChainId: 10143 }, false, "chain-mismatch"],
  ["both on testnet", { isConnected: true, walletChainId: 10143, nodeChainId: 10143 }, true, "ok"],
  ["both on anvil", { isConnected: true, walletChainId: 31337, nodeChainId: 31337 }, true, "ok"],
]

for (const [name, state, allowed, reason] of cases) {
  const got = mintGate(state)
  assert.equal(got.allowed, allowed, `${name}: expected allowed=${allowed}, got ${got.allowed}`)
  assert.equal(got.reason, reason, `${name}: expected ${reason}, got ${got.reason}`)
  console.log(`  ok  ${name} -> ${got.reason}`)
}
console.log(`\n${cases.length} passed`)
