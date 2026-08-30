/**
 * The mint gate, including a regression for the bug that sent a real testnet
 * transaction to an anvil address: wallet on 10143, app reading 31337.
 *
 *   npx tsx test/chain-gate.test.ts
 */
import assert from "node:assert/strict"
import { mintGate } from "../lib/chain-gate.js"
import { NETWORKS, chainName, readChainId } from "../lib/networks.js"

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
/**
 * Which chain the app reads.
 *
 * The bug this covers: activeNetwork falls back to the first configured network
 * when the picked chain has no contract, and the RPC client used to follow the
 * pick instead of the fallback -- so the app read one chain's contract address
 * over another chain's RPC. That returns empty rather than erroring, and the
 * page then reports a missing contract on a chain it never queried.
 */
const first = NETWORKS[0]?.chain.id
const chainCases: [string, () => void][] = [
  ["reading a configured chain keeps it", () => {
    if (!first) return
    assert.equal(readChainId(first), first)
  }],
  ["reading an unconfigured chain follows the fallback, not the pick", () => {
    if (!first) return
    assert.equal(readChainId(31337), first)
    assert.notEqual(readChainId(31337), 31337)
  }],
  ["a chain nothing knows also follows the fallback", () => {
    if (!first) return
    assert.equal(readChainId(999999), first)
  }],
  // chainName once read NETWORKS only, so the wallet-mismatch banner named the
  // app's chain and printed a bare id for the wallet's.
  ["every known chain has a name, deployed or not", () => {
    assert.equal(chainName(143), "Monad")
    assert.equal(chainName(10143), "Monad Testnet")
    assert.equal(chainName(1), "Ethereum")
    assert.equal(chainName(11155111), "Sepolia")
    assert.equal(chainName(10), "OP Mainnet")
    assert.equal(chainName(11155420), "OP Sepolia")
    assert.equal(chainName(31337), "Anvil (local)")
    assert.equal(chainName(999999), "chainId 999999")
  }],
]

for (const [name, run] of chainCases) {
  run()
  console.log(`  ok  ${name}`)
}

console.log(`\n${cases.length + chainCases.length} passed`)
