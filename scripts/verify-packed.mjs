/**
 * Prove MNISTPacked computes the same function as the deployed MNISTNFT.
 *
 * MNISTPacked keeps MNISTNFT's storage layout slot for slot, so this needs no
 * deployment and no funds: it takes the deployed model's own storage with
 * prestateTracer, replays it under the new code with an eth_call state
 * override, and compares.
 *
 * Three things are checked, because two would not be enough:
 *   - the packed logits against an independent reference implemented here in
 *     JavaScript, so the two contracts are not merely checked against each
 *     other;
 *   - the packed label against the deployed contract's label, end to end;
 *   - the packed logits against the deployed contract's *own* logits, lifted
 *     out of its trace, which closes the loop directly rather than through the
 *     reference.
 *
 * Wide-valued inputs are included on purpose: the lane width MNISTPacked picks
 * depends on the model and the input, and 64- and 128-bit lanes would otherwise
 * never be exercised by MNIST pixels.
 *
 *   npm i -D solc@0.8.28
 *   node scripts/verify-packed.mjs [rpcUrl] [contractAddress]
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import {
  encodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbiParameters,
  keccak256, encodeAbiParameters, toFunctionSelector,
} from "viem"

const require = createRequire(import.meta.url)

const M = process.argv[2] || process.env.NEXT_PUBLIC_RPC_URL_143 || "https://rpc.monad.xyz"
const DEPLOYED = (process.argv[3] || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_143 ||
  JSON.parse(fs.readFileSync("deployments.monad.json", "utf8")).contracts.MNISTNFT).toLowerCase()
/**
 * Where MNISTPacked runs. Given a deployed address (argv[4]), the chain already
 * holds the code and the override carries only the model's storage -- which
 * checks what is actually deployed rather than what recompiles here. Otherwise
 * the code is overridden onto an address with none, and nothing is deployed.
 */
const DEPLOYED_PACKED = (process.argv[4] || process.env.PACKED_ADDRESS || "").toLowerCase()
const PACKED = DEPLOYED_PACKED || "0x0000000000000000000000000000000000009ac6"
const SRC = path.join("model", "scripts_for_contracts_and_test", "contracts", "MNISTPacked.sol")
const ARTIFACT = path.join("model", "scripts_for_contracts_and_test", "out", "MNISTPacked.sol", "MNISTPacked.json")

/** forge build writes the same settings foundry.toml pins; solc is the fallback. */
function compiled() {
  if (fs.existsSync(ARTIFACT)) {
    const a = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"))
    return { abi: a.abi, code: a.deployedBytecode.object.replace(/^0x/, "") }
  }
  let solc
  try {
    solc = require("solc")
  } catch {
    console.error("No forge artifact; this script then needs the Solidity compiler: npm i -D solc@0.8.28")
    process.exit(1)
  }
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity",
    sources: { "M.sol": { content: fs.readFileSync(SRC, "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } } } })))
  for (const e of out.errors ?? []) if (e.severity === "error") { console.error(e.formattedMessage); process.exit(1) }
  const c = out.contracts["M.sol"].MNISTPacked
  return { abi: c.abi, code: c.evm.deployedBytecode.object }
}
const { abi, code } = compiled()
const rpc = async (m, p) => (await (await fetch(M, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json())
const INF = [{ name: "inference", type: "function", stateMutability: "view",
  inputs: [{ type: "uint256" }, { type: "int256[][]" }], outputs: [{ type: "uint256" }] }]

const seed = Array.from({ length: 28 }, () => Array(28).fill(0n))
const pre = await rpc("debug_traceCall", [{ to: DEPLOYED,
  data: encodeFunctionData({ abi: INF, functionName: "inference", args: [1n, seed] }), gas: "0x5f5e100" },
  "latest", { tracer: "prestateTracer" }])
const registry = pre.result[DEPLOYED] ?? pre.result[DEPLOYED.toLowerCase()]
const OV = { [PACKED]: DEPLOYED_PACKED
  ? { stateDiff: registry.storage }
  : { code: "0x" + code, stateDiff: registry.storage } }
console.log(DEPLOYED_PACKED
  ? `MNISTPacked deployed at ${PACKED}: ${(await rpc("eth_getCode", [PACKED, "latest"])).result.length / 2 - 1} bytes on chain`
  : `MNISTPacked compiled: ${code.length / 2} bytes (not deployed; overridden onto ${PACKED})`)
console.log(`replaying ${Object.keys(registry.storage).length} storage slots of ${DEPLOYED} under it\n`)

// ---- independent reference, read from the same storage
const hex32 = (n) => "0x" + n.toString(16).padStart(64, "0")
const at = async (slot) => (await rpc("eth_getStorageAt", [DEPLOYED, hex32(slot), "latest"])).result
const base = BigInt(keccak256(encodeAbiParameters(parseAbiParameters("uint256, uint256"), [1n, 9n])))
const s8 = (b) => (b >= 128n ? b - 256n : b)
const s256 = (v) => (v >= 1n << 255n ? v - (1n << 256n) : v)
async function words(i) { const n = Number(BigInt(await at(base + BigInt(i))))
  const st = BigInt(keccak256(hex32(base + BigInt(i)))); const w = []
  for (let k = 0; k < n; k++) w.push(BigInt(await at(st + BigInt(k)))); return w }
const unpack = (w, n) => Array.from({ length: n }, (_, i) => s8((w[Math.floor(i / 32)] >> BigInt((i % 32) * 8)) & 0xffn))
async function biases(i, n) { const st = BigInt(keccak256(hex32(base + BigInt(i)))); const b = []
  for (let k = 0; k < n; k++) b.push(s256(BigInt(await at(st + BigInt(k))))); return b }
const sw = BigInt(await at(base)); const f16 = (i) => Number((sw >> BigInt(i * 16)) & 0xffffn)
const S = { c1o: f16(0), c1i: f16(1), c1k: f16(2), c2o: f16(3), c2i: f16(4), c2k: f16(5), fo: f16(6), fi: f16(7) }
const W1 = unpack(await words(1), S.c1o * S.c1i * S.c1k ** 2)
const W2 = unpack(await words(2), S.c2o * S.c2i * S.c2k ** 2)
const WF = unpack(await words(3), S.fo * S.fi)
const B1 = await biases(4, S.c1o), B2 = await biases(5, S.c2o), BF = await biases(6, S.fo)

function conv(inp, H, Wd, kw, outC, inC, k, bias) {
  const oh = H + 2 - k + 1, ow = Wd + 2 - k + 1, o = []
  for (let oc = 0; oc < outC; oc++) { const pl = []
    for (let y = 0; y < oh; y++) { const row = []
      for (let x = 0; x < ow; x++) { let acc = bias[oc]
        for (let ic = 0; ic < inC; ic++) for (let ky = 0; ky < k; ky++) {
          const iy = y + ky - 1; if (iy < 0 || iy >= H) continue
          for (let kx = 0; kx < k; kx++) { const ix = x + kx - 1; if (ix < 0 || ix >= Wd) continue
            acc += inp[ic][iy][ix] * kw[((oc * inC + ic) * k + ky) * k + kx] } }
        row.push(acc > 0n ? acc : 0n) } pl.push(row) } o.push(pl) } return o }
const pool = (p) => p.map((ch) => Array.from({ length: (ch.length - 2) / 2 + 1 }, (_, y) =>
  Array.from({ length: (ch[0].length - 2) / 2 + 1 }, (_, x) => { let m = ch[y * 2][x * 2]
    for (const [dy, dx] of [[0, 1], [1, 0], [1, 1]]) { const v = ch[y * 2 + dy][x * 2 + dx]; if (v > m) m = v }
    return m })))
function reference(img) {
  let p = pool(conv([img], 28, 28, W1, S.c1o, S.c1i, S.c1k, B1))
  p = pool(conv(p, p[0].length, p[0][0].length, W2, S.c2o, S.c2i, S.c2k, B2))
  const flat = p.flat(2)
  const lg = Array.from({ length: S.fo }, (_, j) => { let s = BF[j]
    for (let i = 0; i < S.fi; i++) s += flat[i] * WF[j * S.fi + i]; return s })
  let best = 0; for (let i = 1; i < lg.length; i++) if (lg[i] > lg[best]) best = i
  return { logits: lg, label: best }
}
/** What lane width the contract will choose, computed the same way it does. */
function laneBitsFor(img) {
  const gain = (w, outC, per) => { let mx = 0n
    for (let oc = 0; oc < outC; oc++) { let s = 0n
      for (let i = 0; i < per; i++) { const v = w[oc * per + i]; s += v >= 0n ? v : -v }
      if (s > mx) mx = s } return mx }
  const mx = (b) => b.reduce((a, v) => { const u = v >= 0n ? v : -v; return u > a ? u : a }, 0n)
  const peak = img.flat().reduce((a, v) => (v > a ? v : a), 0n)
  const acc1 = peak * gain(W1, S.c1o, S.c1i * S.c1k ** 2), act1 = acc1 + mx(B1)
  const acc2 = act1 * gain(W2, S.c2o, S.c2i * S.c2k ** 2), act2 = acc2 + mx(B2)
  const widest = [peak, acc1, act1, acc2, act2].reduce((a, v) => (v > a ? v : a), 0n)
  return widest < 1n << 32n ? 32 : widest < 1n << 64n ? 64 : widest < 1n << 128n ? 128 : 0
}

let state = 20260828
const rnd = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) >>> 8
function image(kind, scale = 255n) {
  const g = Array.from({ length: 28 }, () => Array(28).fill(0n))
  if (kind === "zeros") return g
  if (kind === "full") return g.map((r) => r.fill(scale))
  if (kind === "point") { g[14][14] = scale; return g }
  if (kind === "corners") { g[0][0] = scale; g[0][27] = scale; g[27][0] = scale; g[27][27] = scale; return g }
  if (kind === "dense") return g.map((r) => r.map(() => BigInt(rnd()) % (scale + 1n)))
  if (kind === "sparse") return g.map((r) => r.map(() => (rnd() % 8 === 0 ? BigInt(rnd()) % (scale + 1n) : 0n)))
  for (let s = 0; s < 3; s++) { let x = rnd() % 28, y = rnd() % 28
    for (let t = 0; t < 14; t++) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx
        if (yy >= 0 && yy < 28 && xx >= 0 && xx < 28) g[yy][xx] = scale }
      x = Math.max(0, Math.min(27, x + (rnd() % 3) - 1)); y = Math.max(0, Math.min(27, y + (rnd() % 3) - 1)) }
  }
  return g
}
const call = (to, data, gas, ov) => rpc("eth_call", [{ to, data, gas: "0x" + gas.toString(16) }, "latest", ov])
const packedLogits = async (img) => {
  const r = await call(PACKED, encodeFunctionData({ abi, functionName: "logits", args: [1n, img] }), 60_000_000, OV)
  return r.result ? decodeFunctionResult({ abi, functionName: "logits", data: r.result }) : { err: r.error?.message }
}
const packedLabel = async (img) => {
  const r = await call(PACKED, encodeFunctionData({ abi, functionName: "inference", args: [1n, img] }), 60_000_000, OV)
  return r.result ? Number(decodeFunctionResult({ abi, functionName: "inference", data: r.result })) : null
}
const deployedLabel = async (img) => {
  const r = await call(DEPLOYED, encodeFunctionData({ abi: INF, functionName: "inference", args: [1n, img] }), 140_000_000, {})
  return r.result ? Number(decodeFunctionResult({ abi: INF, functionName: "inference", data: r.result })) : null
}
/** The deployed contract's own logits, lifted out of its trace. */
const FC_SEL = toFunctionSelector("fullyConnected(int256[],int256[][],int256[])")
async function deployedLogits(img) {
  const t = await rpc("debug_traceCall", [{ to: DEPLOYED,
    data: encodeFunctionData({ abi: INF, functionName: "inference", args: [1n, img] }), gas: "0x5f5e100" },
    "latest", { tracer: "callTracer" }])
  let found = null
  ;(function walk(c) { for (const k of c.calls ?? []) { if ((k.input ?? "").startsWith(FC_SEL)) found = k.output; walk(k) } })(t.result)
  return found ? decodeAbiParameters(parseAbiParameters("int256[]"), found)[0] : null
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
let n = 0, bad = 0
const lanesSeen = {}
async function check(label, img, opts = {}) {
  const lb = laneBitsFor(img)
  lanesSeen[lb] = (lanesSeen[lb] ?? 0) + 1
  const ref = reference(img)
  const got = await packedLogits(img)
  n++
  if (got.err) { bad++; console.log(`\n  ${label}: packed reverted — ${got.err}`); return }
  if (!eq(got, ref.logits)) { bad++; console.log(`\n  ${label}: LOGITS DIFFER from reference`); return }
  if (opts.vsDeployed) {
    const [pl, dl] = await Promise.all([packedLabel(img), deployedLabel(img)])
    if (pl === null || dl === null || pl !== dl) { bad++; console.log(`\n  ${label}: label packed ${pl} vs deployed ${dl}`); return }
  }
  if (opts.vsDeployedLogits) {
    const dl = await deployedLogits(img)
    if (!dl || !eq(got, dl)) { bad++; console.log(`\n  ${label}: LOGITS DIFFER from the deployed contract's own trace`); return }
  }
  process.stdout.write(".")
}

console.log("A. 150 ordinary images (0..255), packed logits vs independent reference")
for (let i = 0; i < 150; i++) {
  const kind = ["zeros", "full", "point", "corners", "dense", "sparse"][i % 6] ?? "strokes"
  await check(`A${i}`, image(i < 6 ? kind : "strokes"))
}
console.log(`\n\nB. 24 images checked end to end against the deployed contract's label`)
for (let i = 0; i < 24; i++) await check(`B${i}`, image(i < 4 ? ["zeros", "full", "point", "dense"][i] : "strokes"), { vsDeployed: true })

console.log(`\n\nC. 6 images checked against the deployed contract's own logits, lifted from its trace`)
for (let i = 0; i < 6; i++) await check(`C${i}`, image(i === 0 ? "dense" : "strokes"), { vsDeployedLogits: true })

console.log(`\n\nD. wide inputs, to exercise the 64- and 128-bit lane paths`)
for (const [name, scale] of [["2^20", 1n << 20n], ["2^24", 1n << 24n], ["2^40", 1n << 40n], ["2^52", 1n << 52n]]) {
  for (const kind of ["full", "dense", "strokes"]) {
    const img = image(kind, scale)
    await check(`${name}/${kind}`, img, { vsDeployed: true })
  }
}

console.log(`\n\n${n} images checked, ${bad === 0 ? "0 mismatches" : bad + " MISMATCHES"}`)
console.log(`lane widths exercised: ${Object.entries(lanesSeen).map(([k, v]) => `${k}-bit x${v}`).join(", ")}`)

// ---- what it cost, bisected rather than estimated

const bar = image("strokes")
const data = encodeFunctionData({ abi: INF, functionName: "inference", args: [1n, bar] })
async function gasNeeded(to, ov) {
  let lo = 21_000
  let hi = 140_000_000
  const runs = (g) => rpc("eth_call", [{ to, data, gas: `0x${g.toString(16)}` }, "latest", ov])
    .then((r) => "result" in r)
  if (!(await runs(hi))) return null
  while (hi - lo > 1_000) {
    const mid = Math.floor((lo + hi) / 2)
    if (await runs(mid)) hi = mid
    else lo = mid
  }
  return hi
}
const before = await gasNeeded(DEPLOYED, {})
const after = await gasNeeded(PACKED, OV)
console.log(`\nMNISTNFT    ${before.toLocaleString().padStart(11)} gas`)
console.log(`MNISTPacked ${after.toLocaleString().padStart(11)} gas   ${(before / after).toFixed(1)}x smaller\n`)
for (const [name, cap] of [
  ["Ethereum / OP / BNB", 16_777_216],
  ["Monad", 30_000_000],
  ["Arbitrum One", 32_000_000],
]) {
  const fits = (g) => (g <= cap ? "fits" : "over").padEnd(4)
  console.log(`  per-transaction cap ${cap.toLocaleString().padStart(10)}  ${name.padEnd(21)}` +
    `  MNISTNFT ${fits(before)}   MNISTPacked ${fits(after)}`)
}

process.exit(bad === 0 ? 0 : 1)
