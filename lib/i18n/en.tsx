import type { ReactNode } from "react"

import { Mono } from "./parts"

/**
 * The English message set, and the shape every other locale has to match:
 * `Messages` is `typeof en`, so a key a translation forgets or misspells is a
 * type error rather than a blank spot on the page.
 *
 * Anything carrying markup or a number is a function returning a node, so the
 * translation decides word order instead of being handed a pre-joined string.
 *
 * Contract, function and layer names (MNISTNFT, conv2D, pool1, relu) are
 * identifiers in the code being demonstrated. They are deliberately left
 * untranslated in every locale -- they are what you would grep for.
 */
export const en = {
  meta: {
    title: "On-Chain Digit Recognition",
  },
  common: {
    noNetwork: "no network",
    reading: "reading…",
    none: "—",
  },
  language: {
    label: "Language",
  },
  header: {
    title: "On-Chain Digit Recognition",
    tagline: "Every multiply-accumulate runs inside an EVM contract",
  },
  network: {
    label: "Network",
    mainnetSuffix: " · mainnet",
  },
  banner: {
    missingContract: (address: string, network: string, envVar: string): ReactNode => (
      <>
        No contract code at <Mono>{address}</Mono> on {network}. The chain may have been reset
        again — redeploy and update <Mono>{envVar}</Mono>.
      </>
    ),
    unconfigured: (): ReactNode => (
      <>
        No network is configured. Set <Mono>NEXT_PUBLIC_CONTRACT_ADDRESS_&lt;chainId&gt;</Mono> to a
        deployed registry — see <Mono>.env.example</Mono>.
      </>
    ),
    localNode: (nodeChainId: number, walletChainId: number, network: string): ReactNode => (
      <>
        This app is reading a local node (chainId {nodeChainId}); your wallet is on chain{" "}
        {walletChainId}. A browser wallet cannot write to a local node — run{" "}
        <Mono>npm run dev</Mono> to use {network}.
      </>
    ),
    wrongChain: (walletChainId: number, reading: string) =>
      `Wallet is on chain ${walletChainId}; this app is reading ${reading}.`,
    switchTo: (network: string) => `Switch to ${network}`,
  },
  canvas: {
    title: "Draw a digit",
    range: "0 – 9",
    brush: "Brush",
    clear: "Clear",
    predict: "Predict",
    predicting: "Running on-chain…",
    readOnlyNote: "Inference is a read-only call — no wallet, no gas, no signature.",
  },
  prediction: {
    title: "Prediction",
    latency: "Latency",
    network: "Network",
    token: "Token",
    ms: (ms: number) => `${ms} ms`,
    inputCaption: "What the model receives (28×28)",
  },
  model: {
    title: "Model",
    token: "Token",
    defaultSuffix: " (default)",
    architecture: "Architecture",
    weights: "Weights",
    biases: "Biases",
    owner: "Owner",
    accuracy: "Test accuracy",
    notMinted: "not minted",
    notMeasured: "not measured",
    weightsValue: (weights: string, words: number) => `${weights} int8 in ${words} words`,
    biasesValue: (biases: number) => `${biases} × int256`,
    accuracyNote:
      "Accuracy is not stored on-chain. 98.13% is this repo's own model, measured offline against the MNIST test set; nothing is known about other tokens' weights.",
    tokenLink: (tokenId: string) => `token #${tokenId}`,
  },
  mint: {
    title: "Mint your own model",
    advanced: "Advanced",
    intro: (): ReactNode => (
      <>
        Upload the JSON produced by <Mono>model/train.py</Mono>. One transaction, one confirmation.
      </>
    ),
    choose: "Choose parameters JSON",
    connect: "Connect wallet to mint",
    minting: "Minting…",
    submit: "Mint model NFT",
  },
  execution: {
    title: "Chain execution",
    empty: "Run a prediction to replay the call it made on-chain.",
    blockLabel: (network: string, block: string) => `${network} · block #${block}`,
    axisGas: "x = gas consumed (the EVM's clock)",
    axisIndex: "x = call index (same calls, evenly spaced)",
    summary: (
      calls: string,
      contracts: number,
      gas: string,
      atLeast: boolean,
      blockShare: string
    ): ReactNode => (
      <>
        One prediction is {calls} external calls across {contracts} contracts, burning{" "}
        {atLeast ? "at least " : ""}
        {gas} gas — {blockShare}% of a Monad block. The strips below show{" "}
        <em>which contract is executing and what it costs</em>. Everything here comes from the one
        traced call that produced the prediction; the network is not asked to run the inference
        twice.
      </>
    ),
    gasUnknownNote: (): ReactNode => (
      <>
        {" "}
        (This RPC reports the gas <em>supplied</em> as the root call&apos;s <Mono>gasUsed</Mono>, so
        the total is summed over the external calls instead.)
      </>
    ),
    replayNote: (realMs: number): ReactNode => (
      <>
        The replay runs at real speed — it lasts the {realMs} ms the call actually took, which is
        why it is over almost before you see it. Within that window the play head advances by{" "}
        <strong>gas, not seconds</strong>: a trace records what each call cost, never when it ran,
        so gas is the only per-step clock the EVM has. Drag the slider to walk through it by hand.
      </>
    ),
    role: {
      MNISTNFT: "holds the weights, drives the forward pass",
    },
    card: {
      callsIn: "calls in",
      selfGas: "self gas",
      gas: "gas",
      storageRead: "storage read",
      code: "code",
      words: (n: number) => `${n} words`,
      kilobytes: (kb: string) => `${kb} KB`,
    },
    seekLabel: "Seek through the call sequence",
    pause: "Pause",
    play: "Play",
    replay: (ms: number) => `Replay (${ms} ms)`,
    timing: "Timing layers…",
    retime: "Re-time layers",
    timeLayers: "Time each layer for real",
    hover: "hover",
    step: "step",
    position: (current: string, total: string) => `${current}/${total}`,
    callGas: (gas: string) => `${gas} gas`,
    gasOfTotal: (used: string, total: string) => `${used} / ${total} gas`,
    msInto: (at: string, total: number) => `≈ ${at}/${total} ms in`,
    stageTimesNote: (realMs: number): ReactNode => (
      <>
        Green figures are wall-clock, measured by re-issuing each layer as its own{" "}
        <Mono>eth_call</Mono> with the calldata the trace recorded — the math contracts are pure, so
        the replay returns byte-identical output. Each figure covers that layer&apos;s own call only
        (the per-element <span className="font-mono">relu</span> calls are not re-issued) and
        includes one RPC round trip, so they do not decompose the {realMs} ms of the combined call.
      </>
    ),
    weightsFrom: (label: string): ReactNode => (
      <>
        Weights read from <span className="font-mono">{label}</span> storage
      </>
    ),
    loadingLayout: "Reading…",
    showStorage: "Show storage read",
    noPrestate: "This node does not expose prestateTracer.",
    storageHint:
      "One more traced execution, cached afterwards — the weights are the same for every image, so this is asked once per model.",
    slotsRead: (n: number) => `${n} storage words read · 32 int8 weights packed per word`,
    slotDetail: (index: number, head: string, tail: string) => `slot ${index}: ${head}…${tail}`,
  },
  trace: {
    title: "Execution trace",
    badge: "measured on-chain",
    intro: (): ReactNode => (
      <>
        Every activation below is the actual return value of an on-chain call, read back with{" "}
        <Mono>debug_traceCall</Mono> — the same single call that produced the prediction. Nothing
        here is recomputed in the browser.
      </>
    ),
    loading: "Tracing execution…",
    empty: "Run a prediction to see the layer-by-layer execution.",
    input: "Input",
    channel: (index: number) => `channel ${index}`,
    externalCalls: (n: string) => `${n} external calls`,
    reluCalls: (n: string) => `${n} × relu()`,
    traceSize: (mb: string) => `${mb} MB trace`,
    elapsed: (ms: number) => `${ms} ms`,
    elapsedTitle:
      "The prediction and this trace come from the same traced call: this is how long that call took, including transferring and parsing the trace JSON.",
  },
  footer: {
    source: "Source on GitHub",
  },
  toast: {
    drawFirst: "Draw a digit first",
    noModelTitle: (tokenId: string) => `Token ${tokenId} has no model`,
    noModelBody: "No weights are stored under this id. Try token 1, or mint a model below.",
    traceFailed: (detail: string) => `Could not trace this call: ${detail}`,
    inferenceFailed: "Inference failed",
    noNetwork: "No network configured",
    uploadFirst: "Upload a parameters file first",
    chainUnknownTitle: "Still checking which chain the RPC serves",
    chainUnknownBody: "Try again in a moment.",
    wrongNetworkTitle: "Wrong network",
    wrongNetworkBody: (walletChainId: number, readingChainId: number | null) =>
      `Your wallet is on chain ${walletChainId}; this app is reading chain ${readingChainId}.`,
    noContractOnWalletChain: (address: string) =>
      `No contract at ${address} on the chain your wallet is connected to.`,
    mintSubmitted: "Mint submitted",
    mintedNothing: "Transaction landed but minted nothing -- no Transfer event from the contract.",
    mintedTitle: (tokenId: string) => `Minted token ${tokenId}`,
    mintedBody: "Selected for inference.",
    mintFailed: "Mint failed",
    weightsOutOfRange: "Weights fall outside int8. Regenerate them with the current train.py.",
    paramsLoaded: "Parameters loaded",
    readFileFailed: "Could not read file",
    missingKeys: (keys: string) => `missing keys: ${keys}`,
    unknownError: "unknown error",
  },
}
