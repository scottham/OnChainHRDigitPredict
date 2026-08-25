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
import { traceInference, type InferenceTrace } from "@/lib/trace"
import { Button } from "@/components/ui/button"
import {
  CHAIN,
  CONTRACT_ADDRESS,
  DEFAULT_TOKEN_ID,
  IS_CONFIGURED,
  MNIST_NFT_ABI,
  explorerAddress,
} from "@/lib/contractConfig"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"

type ContractState = "checking" | "ready" | "missing" | "unconfigured"

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function Page() {
  const canvasRef = useRef<CanvasBoardHandle>(null)
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [contractState, setContractState] = useState<ContractState>("checking")
  const [preview, setPreview] = useState<number[][] | null>(null)
  const [prediction, setPrediction] = useState<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [predicting, setPredicting] = useState(false)
  const [brush, setBrush] = useState(26)
  const [tokenId, setTokenId] = useState(DEFAULT_TOKEN_ID.toString())

  const [trace, setTrace] = useState<InferenceTrace | null>(null)
  const [tracing, setTracing] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [tracedInput, setTracedInput] = useState<number[][] | null>(null)

  const [modelFile, setModelFile] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<any>(null)
  const [minting, setMinting] = useState(false)

  const onWrongChain = isConnected && chainId !== CHAIN.id

  /**
   * Confirm the contract still exists before anyone draws.
   *
   * Monad's testnet was re-genesised on 2025-12-16 and wiped every contract
   * deployed before it. Without this check the failure surfaces as an opaque
   * "call reverted" only after the user has drawn something.
   */
  useEffect(() => {
    if (!IS_CONFIGURED) {
      setContractState("unconfigured")
      return
    }
    if (!publicClient) return
    let cancelled = false
    publicClient
      .getBytecode({ address: CONTRACT_ADDRESS })
      .then((code) => {
        if (cancelled) return
        setContractState(code && code !== "0x" ? "ready" : "missing")
      })
      .catch(() => !cancelled && setContractState("missing"))
    return () => {
      cancelled = true
    }
  }, [publicClient])

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
    try {
      const started = performance.now()
      const result = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: MNIST_NFT_ABI,
        functionName: "inference",
        args: [BigInt(tokenId), grid.map((row) => row.map((v) => BigInt(v)))],
      })) as bigint
      setLatency(Math.round(performance.now() - started))
      setPrediction(Number(result))

      // The trace is ~2 MB and takes about a second, so it runs after the
      // answer is already on screen rather than delaying it.
      setTracing(true)
      setTraceError(null)
      setTracedInput(grid)
      traceInference(publicClient, BigInt(tokenId), grid)
        .then(setTrace)
        .catch((err: any) => {
          setTrace(null)
          setTraceError(
            `Could not trace this call: ${(err?.message ?? "unknown error").split("\n")[0]}. ` +
            `The prediction above is unaffected.`
          )
        })
        .finally(() => setTracing(false))
    } catch (err: any) {
      const detail: string = err?.shortMessage || err?.message || "unknown error"
      if (/Token does not exist/.test(detail)) {
        toast.error(`Token ${tokenId} has no model`, {
          description: "No weights are stored under this id. Try token 1, or mint a model below.",
        })
      } else {
        toast.error("Inference failed", { description: detail.split("\n")[0] })
      }
    } finally {
      setPredicting(false)
    }
  }, [publicClient, tokenId])

  const handleMint = useCallback(async () => {
    if (!walletClient || !address) return
    if (!modelParams) {
      toast.warning("Upload a parameters file first")
      return
    }
    setMinting(true)
    try {
      const toBig = (v: any): any => (Array.isArray(v) ? v.map(toBig) : BigInt(v))
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MNIST_NFT_ABI,
        functionName: "mint",
        args: [
          toBig(modelParams.conv1),
          toBig(modelParams.conv1_bias),
          toBig(modelParams.conv2),
          toBig(modelParams.conv2_bias),
          toBig(modelParams.fc),
          toBig(modelParams.fc_bias),
        ],
        chain: CHAIN,
        account: address,
      })
      toast.info("Mint submitted", { description: short(hash) })

      const receipt = await publicClient!.waitForTransactionReceipt({ hash })
      const minted = BigInt(receipt.logs[0].topics[3]!)
      setTokenId(minted.toString())
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
  }, [walletClient, address, modelParams, publicClient])

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
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </header>

        {contractState === "missing" && (
          <Banner tone="danger" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            No contract code at <code className="font-mono">{short(CONTRACT_ADDRESS)}</code> on {CHAIN.name}.
            The testnet may have been reset again — redeploy and update{" "}
            <code className="font-mono">NEXT_PUBLIC_MONADTESTNET_CONTRACT_ADDRESS</code>.
          </Banner>
        )}
        {contractState === "unconfigured" && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            <code className="font-mono">NEXT_PUBLIC_MONADTESTNET_CONTRACT_ADDRESS</code> is not set.
          </Banner>
        )}
        {onWrongChain && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            Wallet is on the wrong network.
            <button
              onClick={() => switchChain({ chainId: CHAIN.id })}
              className="ml-2 underline underline-offset-4 hover:no-underline"
            >
              Switch to {CHAIN.name}
            </button>
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
                  <Row label="Network" value={CHAIN.name} />
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
              <div className="space-y-2 text-xs">
                <Row label="Architecture" value="2×conv + fc" />
                <Row label="Weights" value="int8, on-chain" />
                <Row label="Test accuracy" value="98.13%" />
              </div>
              {IS_CONFIGURED && (
                <a
                  href={explorerAddress(CONTRACT_ADDRESS)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-violet-400 hover:text-violet-300"
                >
                  {short(CONTRACT_ADDRESS)}
                  <ExternalLink className="h-3 w-3" />
                </a>
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
                  disabled={!isConnected || onWrongChain || !modelParams || minting}
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

        <div className="mt-6">
          <InferenceTraceView
            input={tracedInput}
            trace={trace}
            loading={tracing}
            error={traceError}
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
