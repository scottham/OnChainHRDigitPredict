"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi"
import { toast } from "sonner"
import { Eraser, Sparkles, Loader2, AlertTriangle, ExternalLink, Upload, Cpu } from "lucide-react"

import CanvasBoard, { type CanvasBoardHandle } from "@/components/CanvasBoard"
import DigitPreview from "@/components/DigitPreview"
import InferenceTraceView from "@/components/InferenceTrace"
import ChainExecution from "@/components/ChainExecution"
import { traceInference, type InferenceTrace, type Stage } from "@/lib/trace"
import { toMintArgs } from "@/lib/pack"
import { mintGate } from "@/lib/chain-gate"
import { describeArchitecture, readTokenCount, readTokenModel, type TokenModel } from "@/lib/model-registry"
import { Button } from "@/components/ui/button"
import { MNIST_NFT_ABI } from "@/lib/abi"
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_TOKEN_ID,
  NETWORKS,
  chainName,
  explorerAddress,
  explorerToken,
  networkFor,
} from "@/lib/networks"
import NetworkPicker from "@/components/NetworkPicker"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"

type ContractState = "checking" | "ready" | "missing" | "unconfigured"

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

export default function Page() {
  const canvasRef = useRef<CanvasBoardHandle>(null)
  /**
   * The network the app reads from. Persisted so a reload does not silently
   * put someone back on a different chain than the one they chose.
   */
  const [activeChainId, setActiveChainId] = useState(DEFAULT_CHAIN_ID)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("network"))
      if (saved && networkFor(saved)) setActiveChainId(saved)
    } catch {
      // private mode, blocked storage -- the default is fine
    }
  }, [])

  const network = networkFor(activeChainId) ?? NETWORKS[0]
  const contractAddress = (network?.contract ?? "") as `0x${string}`
  const isConfigured = Boolean(network)
  const publicClient = usePublicClient({ chainId: activeChainId })
  const { data: walletClient } = useWalletClient()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [contractState, setContractState] = useState<ContractState>("checking")
  const [nodeChainId, setNodeChainId] = useState<number | null>(null)
  const [preview, setPreview] = useState<number[][] | null>(null)
  const [prediction, setPrediction] = useState<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [predicting, setPredicting] = useState(false)
  const [brush, setBrush] = useState(26)
  const [tokenId, setTokenId] = useState(DEFAULT_TOKEN_ID.toString())
  /** Every minted token is a different model; the page runs the selected one. */
  const [tokenCount, setTokenCount] = useState<number | null>(null)
  const [tokenModel, setTokenModel] = useState<TokenModel | null>(null)

  const [trace, setTrace] = useState<InferenceTrace | null>(null)
  const [tracing, setTracing] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [tracedInput, setTracedInput] = useState<number[][] | null>(null)
  /** Which layer the execution replay is currently inside. */
  const [activeStage, setActiveStage] = useState<Stage["key"] | null>(null)

  const [modelFile, setModelFile] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<any>(null)
  const [minting, setMinting] = useState(false)

  /**
   * The chain that matters is the one the RPC node actually serves, not the one
   * the config names. NEXT_PUBLIC_RPC_URL is overridable, so with
   * the app pointed at a local node and the wallet on testnet, reads and writes
   * go to different chains -- and a write lands at an address that holds the
   * contract locally but nothing at all on the wallet's chain.
   */
  /**
   * Until the node answers, the chain is *unknown*, not assumed. Falling back
   * to CHAIN.id here is what made the old check vacuous: it compared the wallet
   * against a constant that always matched, so a wallet on testnet passed while
   * the app was reading a local node.
   */
  const expectedChainId = nodeChainId
  const gate = mintGate({ isConnected, walletChainId: chainId, nodeChainId })
  const chainUnknown = gate.reason === "chain-unknown"
  const onWrongChain = gate.reason === "chain-mismatch"
  /** A browser wallet cannot reach a node only this machine can see. */
  const isLocalNode = nodeChainId === 31337

  /**
   * The RPC URL is overridable, so the configured chain is not proof of where
   * the calls actually land -- pointing NEXT_PUBLIC_RPC_URL at a
   * local anvil would otherwise still read "Monad Testnet". Label from the id
   * the node itself reports.
   */
  const networkLabel = nodeChainId === null ? network.chain.name : chainName(nodeChainId)

  /**
   * Confirm the contract still exists before anyone draws.
   *
   * Monad's testnet was re-genesised on 2025-12-16 and wiped every contract
   * deployed before it. Without this check the failure surfaces as an opaque
   * "call reverted" only after the user has drawn something.
   */
  useEffect(() => {
    if (!isConfigured) {
      setContractState("unconfigured")
      return
    }
    if (!publicClient) return
    let cancelled = false
    publicClient
      .getBytecode({ address: contractAddress })
      .then((code) => {
        if (cancelled) return
        setContractState(code && code !== "0x" ? "ready" : "missing")
      })
      .catch(() => !cancelled && setContractState("missing"))
    publicClient
      .getChainId()
      .then((id) => !cancelled && setNodeChainId(id))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [publicClient, contractAddress])

  useEffect(() => {
    if (!publicClient || contractState !== "ready") return
    let cancelled = false
    readTokenCount(publicClient, contractAddress)
      .then((n) => !cancelled && setTokenCount(n))
      .catch(() => !cancelled && setTokenCount(null))
    return () => {
      cancelled = true
    }
  }, [publicClient, contractState, contractAddress])

  useEffect(() => {
    if (!publicClient || contractState !== "ready") return
    let cancelled = false
    setTokenModel(null)
    readTokenModel(publicClient, contractAddress, BigInt(tokenId))
      .then((m) => !cancelled && setTokenModel(m))
      .catch(() => !cancelled && setTokenModel(null))
    return () => {
      cancelled = true
    }
  }, [publicClient, contractState, tokenId])

  /** Switching network invalidates the model list and everything measured. */
  const handleSelectNetwork = useCallback((chainId: number) => {
    setActiveChainId(chainId)
    try {
      localStorage.setItem("network", String(chainId))
    } catch {
      // storage blocked -- the choice just will not survive a reload
    }
    setContractState("checking")
    setNodeChainId(null)
    setTokenCount(null)
    setTokenModel(null)
    setTokenId(DEFAULT_TOKEN_ID.toString())
    setPrediction(null)
    setLatency(null)
    setTrace(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  /** Switching model invalidates everything measured from the previous one. */
  const handleSelectToken = useCallback((next: string) => {
    setTokenId(next)
    setPrediction(null)
    setLatency(null)
    setTrace(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  const handleClear = useCallback(() => {
    canvasRef.current?.clearCanvas()
    setPrediction(null)
    setLatency(null)
    setTrace(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  /** Inference is a view call -- no wallet, no gas, no signature. */
  const handlePredict = useCallback(async () => {
    const grid = canvasRef.current?.getProcessedInput()
    if (!grid) {
      toast.warning("Draw a digit first")
      return
    }
    if (!publicClient) return

    setPredicting(true)
    setPrediction(null)
    setTracing(true)
    setTraceError(null)
    setTracedInput(grid)
    try {
      /**
       * One traced call, not two.
       *
       * debug_traceCall returns the root call's own output, which is the
       * prediction, alongside every child call. Asking for the answer with
       * readContract and then tracing it would make the node run the same ~50M
       * gas of work twice for a single click.
       */
      const started = performance.now()
      const result = await traceInference(publicClient, contractAddress, BigInt(tokenId), grid)
      setLatency(Math.round(performance.now() - started))
      setPrediction(result.prediction)
      setTrace(result)
    } catch (err: any) {
      const detail: string = err?.shortMessage || err?.message || "unknown error"
      if (/Token does not exist/.test(detail)) {
        toast.error(`Token ${tokenId} has no model`, {
          description: "No weights are stored under this id. Try token 1, or mint a model below.",
        })
        setPredicting(false)
        setTracing(false)
        return
      }

      // An RPC without the debug namespace can still answer the question; it
      // just cannot show the work. Fall back to a plain call rather than
      // failing the prediction.
      setTrace(null)
      setTraceError(`Could not trace this call: ${detail.split("\n")[0]}`)
      try {
        const started = performance.now()
        const result = (await publicClient.readContract({
          address: contractAddress,
          abi: MNIST_NFT_ABI,
          functionName: "inference",
          args: [BigInt(tokenId), grid.map((row) => row.map((v) => BigInt(v)))],
        })) as bigint
        setLatency(Math.round(performance.now() - started))
        setPrediction(Number(result))
      } catch (fallbackErr: any) {
        toast.error("Inference failed", {
          description: (fallbackErr?.shortMessage || fallbackErr?.message || detail).split("\n")[0],
        })
      }
    } finally {
      setPredicting(false)
      setTracing(false)
    }
  }, [publicClient, tokenId])

  const handleMint = useCallback(async () => {
    if (!walletClient || !address) return
    if (!modelParams) {
      toast.warning("Upload a parameters file first")
      return
    }
    if (!gate.allowed && gate.reason === "chain-unknown") {
      toast.error("Still checking which chain the RPC serves", {
        description: "Try again in a moment.",
      })
      return
    }
    if (!gate.allowed) {
      toast.error("Wrong network", {
        description: `Your wallet is on chain ${chainId}; this app is reading chain ${expectedChainId}.`,
      })
      return
    }

    setMinting(true)
    try {
      /**
       * Ask the wallet's own node whether the contract is there. The read
       * transport and the wallet can be pointed at different chains, and a
       * transaction sent to an address with no code does not revert -- it
       * succeeds as a plain transfer and mints nothing.
       */
      const code = (await walletClient.request({
        method: "eth_getCode",
        params: [contractAddress, "latest"],
      } as any)) as string
      if (!code || code === "0x") {
        throw new Error(
          `No contract at ${short(contractAddress)} on the chain your wallet is connected to.`
        )
      }

      /**
       * Weights go up packed, 32 int8 per word. Sent as int[] the same model is
       * ~108 KB of calldata, which MetaMask rejects outright with "Request too
       * large" before the transaction ever reaches the chain.
       */
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MNIST_NFT_ABI,
        functionName: "mint",
        args: toMintArgs(modelParams),
        chain: network.chain,
        account: address,
      })
      toast.info("Mint submitted", { description: short(hash) })

      const receipt = await publicClient!.waitForTransactionReceipt({ hash })
      // Match the Transfer this contract emitted rather than trusting logs[0].
      const transfer = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === contractAddress.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[3] !== undefined
      )
      if (!transfer) {
        throw new Error("Transaction landed but minted nothing -- no Transfer event from the contract.")
      }
      const minted = BigInt(transfer.topics[3]!)
      setTokenCount((n) => Math.max(n ?? 0, Number(minted)))
      handleSelectToken(minted.toString())
      toast.success(`Minted token ${minted}`, { description: "Selected for inference." })
    } catch (err: any) {
      const detail: string = err?.shortMessage || err?.message || "unknown error"
      toast.error("Mint failed", {
        description: /int8/i.test(detail)
          ? "Weights fall outside int8. Regenerate them with the current train.py."
          : detail.split("\n")[0],
      })
    } finally {
      setMinting(false)
    }
  }, [walletClient, address, modelParams, publicClient, gate, chainId, expectedChainId])

  return (
    <div className="min-h-svh bg-gradient-to-b from-background via-background to-violet-950/20">
      <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src={monadLogo} alt="" width={36} height={36} className="rounded-lg" />
            <div>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                On-Chain Digit Recognition
              </h1>
              <p className="text-xs text-muted-foreground">
                Every multiply-accumulate runs inside an EVM contract
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NetworkPicker active={network} onChange={handleSelectNetwork} />
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </header>

        {contractState === "missing" && (
          <Banner tone="danger" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            No contract code at <code className="font-mono">{short(contractAddress)}</code> on {network.chain.name}.
            The testnet may have been reset again — redeploy and update{" "}
            <code className="font-mono">NEXT_PUBLIC_contractAddress</code>.
          </Banner>
        )}
        {contractState === "unconfigured" && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            <code className="font-mono">NEXT_PUBLIC_contractAddress</code> is not set.
          </Banner>
        )}
        {onWrongChain && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            {isLocalNode ? (
              <>
                This app is reading a local node (chainId {nodeChainId}); your wallet is on chain{" "}
                {chainId}. A browser wallet cannot write to a local node — run{" "}
                <code className="font-mono">npm run dev</code> to use {network.chain.name}.
              </>
            ) : (
              <>
                Wallet is on chain {chainId}; this app is reading {networkLabel}.
                <button
                  onClick={() => switchChain({ chainId: expectedChainId! })}
                  className="ml-2 underline underline-offset-4 hover:no-underline"
                >
                  Switch to {networkLabel}
                </button>
              </>
            )}
          </Banner>
        )}

        <main className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-medium">Draw a digit</h2>
              <span className="text-xs text-muted-foreground">0 – 9</span>
            </div>

            <div className="mx-auto w-full max-w-[420px]">
              <CanvasBoard ref={canvasRef} brushSize={brush} onStrokeEnd={setPreview} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex flex-1 items-center gap-3 text-xs text-muted-foreground">
                Brush
                <input
                  type="range"
                  min={12}
                  max={44}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                  className="h-1 flex-1 cursor-pointer accent-violet-500"
                />
              </label>
              <Button variant="outline" size="sm" onClick={handleClear} className="gap-2">
                <Eraser className="h-4 w-4" />
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handlePredict}
                disabled={predicting || contractState !== "ready"}
                className="gap-2 bg-violet-600 hover:bg-violet-700"
              >
                {predicting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {predicting ? "Running on-chain…" : "Predict"}
              </Button>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Inference is a read-only call — no wallet, no gas, no signature.
            </p>
          </section>

          <aside className="flex flex-col gap-6">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
              <h2 className="mb-4 font-medium">Prediction</h2>
              <div className="flex items-center gap-5">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-black/40">
                  {predicting ? (
                    <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
                  ) : prediction !== null ? (
                    <span className="text-5xl font-semibold tabular-nums text-violet-300">{prediction}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div className="min-w-0 space-y-2 text-xs">
                  <Row label="Latency" value={latency !== null ? `${latency} ms` : "—"} />
                  <Row label="Network" value={networkLabel} />
                  <Row label="Token" value={`#${tokenId}`} />
                </div>
              </div>

              <div className="mt-5 border-t border-border/60 pt-4">
                <p className="mb-2 text-xs text-muted-foreground">What the model receives (28×28)</p>
                <DigitPreview grid={preview} />
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
              <h2 className="mb-3 flex items-center gap-2 font-medium">
                <Cpu className="h-4 w-4 text-violet-400" />
                Model
              </h2>
              {/* The model is the token, so everything below describes the
                  selected id -- read from its storage, not hardcoded. */}
              <label className="mb-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Token</span>
                {tokenCount && tokenCount > 0 ? (
                  <select
                    value={tokenId}
                    onChange={(e) => handleSelectToken(e.target.value)}
                    className="rounded-lg border border-border/60 bg-black/40 px-2 py-1 font-mono text-xs outline-none focus:border-violet-400/60"
                  >
                    {Array.from({ length: tokenCount }, (_, i) => String(i + 1)).map((id) => (
                      <option key={id} value={id}>
                        #{id}
                        {id === DEFAULT_TOKEN_ID.toString() ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-xs">#{tokenId}</span>
                )}
              </label>

              <div className="space-y-2 text-xs">
                <Row
                  label="Architecture"
                  value={tokenModel ? describeArchitecture(tokenModel) : "reading…"}
                />
                <Row
                  label="Weights"
                  value={
                    tokenModel
                      ? `${tokenModel.weights.toLocaleString()} int8 in ${tokenModel.words} words`
                      : "reading…"
                  }
                />
                <Row label="Biases" value={tokenModel ? `${tokenModel.biases} × int256` : "reading…"} />
                <Row
                  label="Owner"
                  value={tokenModel?.owner ? short(tokenModel.owner) : tokenModel ? "not minted" : "reading…"}
                />
                {tokenId === DEFAULT_TOKEN_ID.toString() ? (
                  <Row label="Test accuracy" value="98.13%" />
                ) : (
                  <Row label="Test accuracy" value="not measured" />
                )}
              </div>
              {tokenId !== DEFAULT_TOKEN_ID.toString() && (
                <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
                  Accuracy is not stored on-chain. 98.13% is this repo&apos;s own model, measured
                  offline against the MNIST test set; nothing is known about other tokens&apos;
                  weights.
                </p>
              )}
              {isConfigured && (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a
                    href={explorerToken(network, tokenId) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-violet-400 hover:text-violet-300"
                  >
                    token #{tokenId}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={explorerAddress(network, contractAddress) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-violet-300"
                  >
                    {short(contractAddress)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            <details className="group rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
              <summary className="cursor-pointer list-none font-medium marker:content-none">
                <span className="flex items-center justify-between">
                  Mint your own model
                  <span className="text-xs text-muted-foreground group-open:hidden">Advanced</span>
                </span>
              </summary>

              <p className="mt-3 text-xs text-muted-foreground">
                Upload the JSON produced by <code className="font-mono">model/train.py</code>. One transaction,
                one confirmation.
              </p>

              <div className="mt-4 space-y-3">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs hover:border-violet-500/60 hover:bg-violet-500/5">
                  <Upload className="h-4 w-4" />
                  <span className="truncate">{modelFile ?? "Choose parameters JSON"}</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try {
                        const parsed = JSON.parse(await file.text())
                        const required = ["conv1", "conv1_bias", "conv2", "conv2_bias", "fc", "fc_bias"]
                        const missing = required.filter((k) => !(k in parsed))
                        if (missing.length) throw new Error(`missing keys: ${missing.join(", ")}`)
                        setModelParams(parsed)
                        setModelFile(file.name)
                        toast.success("Parameters loaded")
                      } catch (err: any) {
                        setModelParams(null)
                        setModelFile(null)
                        toast.error("Could not read file", { description: err.message })
                      }
                    }}
                  />
                </label>

                <Button
                  onClick={handleMint}
                  disabled={!gate.allowed || !modelParams || minting}
                  className="w-full gap-2"
                  size="sm"
                >
                  {minting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {!isConnected ? "Connect wallet to mint" : minting ? "Minting…" : "Mint model NFT"}
                </Button>
              </div>
            </details>
          </aside>
        </main>

        <div className="mt-6 space-y-6">
          <ChainExecution
            trace={trace}
            network={network}
            networkLabel={networkLabel}
            latencyMs={latency}
            tokenId={BigInt(tokenId)}
            input={tracedInput}
            onStage={setActiveStage}
          />
          <InferenceTraceView
            input={tracedInput}
            trace={trace}
            loading={tracing}
            error={traceError}
            activeStage={activeStage}
          />
        </div>

        <footer className="mt-8 border-t border-border/60 pt-4 text-center text-xs text-muted-foreground">
          <a
            href="https://github.com/scottham/OnChainHRDigitPredict"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium tabular-nums">{value}</span>
    </div>
  )
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "danger" | "warning"
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const styles =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-amber-500/40 bg-amber-500/10 text-amber-200"
  return (
    <div className={`mb-6 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {icon}
      <div>{children}</div>
    </div>
  )
}
