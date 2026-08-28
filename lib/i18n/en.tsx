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
    summary: (gas: string, blockShare: string): ReactNode => (
      <>
        One prediction is <strong>one call and no external calls at all</strong>, burning {gas} gas
        — {blockShare}% of a Monad block. There is nothing to trace: MNISTPacked computes every
        layer inside itself, which is most of why it costs a fifth of what a call-per-layer
        implementation does. The bar below is therefore a <em>measurement</em>, not a trace: each
        segment is the difference between two <Mono>eth_estimateGas</Mono> runs of the pipeline cut
        short at successive layers.
      </>
    ),
    noEstimate: "This node would not estimate gas, so the per-layer breakdown is unavailable.",
    replayNote: (realMs: number): ReactNode => (
      <>
        The replay runs at real speed — it lasts the {realMs} ms the call actually took, which is
        why it is over almost before you see it. Within that window the play head advances by{" "}
        <strong>gas, not seconds</strong>: nothing on chain records when a layer ran, only what it
        cost, so gas is the only per-step clock the EVM has — and measuring a layer&apos;s wall
        clock from here is hopeless anyway, since one RPC round trip is longer than the whole
        prediction. Drag the slider to walk through it by hand.
      </>
    ),
    stageLabel: {
      load: "load model",
      pack: "pack input",
      conv1: "conv1 + ReLU",
      pool1: "pool1",
      conv2: "conv2 + ReLU",
      pool2: "pool2",
      flatten: "flatten",
      fc: "fc",
    } as Record<string, string>,
    role: {
      MNISTPacked: "holds the weights and runs the whole forward pass",
    },
    card: {
      callsIn: "calls in",
      externalCalls: "calls out",
      gas: "gas",
      storageRead: "storage read",
      code: "code",
      words: (n: number) => `${n} words`,
      kilobytes: (kb: string) => `${kb} KB`,
    },
    seekLabel: "Seek through the forward pass",
    pause: "Pause",
    play: "Play",
    replay: (ms: number) => `Replay (${ms} ms)`,
    hover: "hover",
    step: "stage",
    position: (current: number, total: number) => `${current}/${total}`,
    stageGas: (gas: string) => `${gas} gas`,
    gasOfTotal: (used: string, total: string) => `${used} / ${total} gas`,
    msInto: (at: string, total: number) => `≈ ${at}/${total} ms in`,
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
        Every activation below is the actual return value of an on-chain call.{" "}
        <Mono>MNISTPacked.activations()</Mono> reruns the forward pass, stops at that layer and
        unpacks the lanes it holds, so what you see is the contract&apos;s own arithmetic. Nothing
        here is recomputed in the browser.
      </>
    ),
    loading: "Running the layers…",
    empty: "Run a prediction to see the layer-by-layer execution.",
    input: "Input",
    channel: (index: number) => `channel ${index}`,
    noExternalCalls: "0 external calls",
    gasTotal: (gas: string) => `${gas} gas`,
    elapsed: (ms: number) => `${ms} ms`,
    elapsedTitle:
      "How long the prediction call itself took. The activations above were fetched afterwards, in parallel, and are not counted in it.",
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
