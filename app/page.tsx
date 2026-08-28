"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi"
import { toast } from "sonner"
import { Eraser, Sparkles, Loader2, AlertTriangle, ExternalLink, Upload, Cpu } from "lucide-react"

import CanvasBoard, { type CanvasBoardHandle } from "@/components/CanvasBoard"
import DigitPreview from "@/components/DigitPreview"
import InferenceTraceView from "@/components/InferenceTrace"
import ChainExecution from "@/components/ChainExecution"
import { runInference, type InferenceRun, type StageKey } from "@/lib/trace"
import { toMintArgs } from "@/lib/pack"
import { mintGate } from "@/lib/chain-gate"
import { describeArchitecture, readTokenCount, readTokenModel, type TokenModel } from "@/lib/model-registry"
import { Button } from "@/components/ui/button"
import { MNIST_ABI } from "@/lib/abi"
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_TOKEN_ID,
  activeNetwork,
  chainName,
  explorerAddress,
  explorerToken,
  networkFor,
} from "@/lib/networks"
import NetworkPicker from "@/components/NetworkPicker"
import LanguagePicker from "@/components/LanguagePicker"
import { useT } from "@/lib/i18n"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"

type ContractState = "checking" | "ready" | "missing" | "unconfigured"

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

export default function Page() {
  const t = useT()
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

  /**
   * Undefined when nothing is configured at all. The page still renders in that
   * state and says so, so every read of it below has to survive it.
   */
  const network = activeNetwork(activeChainId)
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

  const [run, setRun] = useState<InferenceRun | null>(null)
  const [tracing, setTracing] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [tracedInput, setTracedInput] = useState<number[][] | null>(null)
  /** Which layer the execution replay is currently inside. */
  const [activeStage, setActiveStage] = useState<StageKey | null>(null)

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
  const networkLabel =
    nodeChainId === null ? (network?.chain.name ?? t.common.noNetwork) : chainName(nodeChainId)

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
    setRun(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  /** Switching model invalidates everything measured from the previous one. */
  const handleSelectToken = useCallback((next: string) => {
    setTokenId(next)
    setPrediction(null)
    setLatency(null)
    setRun(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  const handleClear = useCallback(() => {
    canvasRef.current?.clearCanvas()
    setPrediction(null)
    setLatency(null)
    setRun(null)
    setTraceError(null)
    setTracedInput(null)
  }, [])

  /** Inference is a view call -- no wallet, no gas, no signature. */
  const handlePredict = useCallback(async () => {
    const grid = canvasRef.current?.getProcessedInput()
    if (!grid) {
      toast.warning(t.toast.drawFirst)
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
       * The prediction first and alone, then everything the page draws around
       * it -- see lib/trace.ts. The latency shown is the prediction's own, not
       * the whole batch's.
       */
      const result = await runInference(publicClient, contractAddress, BigInt(tokenId), grid)
      setLatency(result.elapsedMs)
      setPrediction(result.prediction)
      setRun(result)
    } catch (err: any) {
      const detail: string = err?.shortMessage || err?.message || t.toast.unknownError
      if (/Token does not exist/.test(detail)) {
        toast.error(t.toast.noModelTitle(tokenId), {
          description: t.toast.noModelBody,
        })
        setPredicting(false)
        setTracing(false)
        return
      }

      // An RPC that will not estimate gas or unpack activations can still
      // answer the question; it just cannot show the work. Fall back to a plain
      // call rather than failing the prediction.
      setRun(null)
      setTraceError(t.toast.traceFailed(detail.split("\n")[0]))
      try {
        const started = performance.now()
        const result = (await publicClient.readContract({
          address: contractAddress,
          abi: MNIST_ABI,
          functionName: "inference",
          args: [BigInt(tokenId), grid.map((row) => row.map((v) => BigInt(v)))],
        })) as bigint
        setLatency(Math.round(performance.now() - started))
        setPrediction(Number(result))
      } catch (fallbackErr: any) {
        toast.error(t.toast.inferenceFailed, {
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
    if (!network) {
      toast.error(t.toast.noNetwork)
      return
    }
    if (!modelParams) {
      toast.warning(t.toast.uploadFirst)
      return
    }
    if (!gate.allowed && gate.reason === "chain-unknown") {
      toast.error(t.toast.chainUnknownTitle, {
        description: t.toast.chainUnknownBody,
      })
      return
    }
    if (!gate.allowed) {
      toast.error(t.toast.wrongNetworkTitle, {
        description: t.toast.wrongNetworkBody(chainId, expectedChainId),
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
        throw new Error(t.toast.noContractOnWalletChain(short(contractAddress)))
      }

      /**
       * Weights go up packed, 32 int8 per word. Sent as int[] the same model is
       * ~108 KB of calldata, which MetaMask rejects outright with "Request too
       * large" before the transaction ever reaches the chain.
       */
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MNIST_ABI,
        functionName: "mint",
        args: toMintArgs(modelParams),
        chain: network.chain,
        account: address,
      })
      toast.info(t.toast.mintSubmitted, { description: short(hash) })

      const receipt = await publicClient!.waitForTransactionReceipt({ hash })
      // Match the Transfer this contract emitted rather than trusting logs[0].
      const transfer = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === contractAddress.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[3] !== undefined
      )
      if (!transfer) {
        throw new Error(t.toast.mintedNothing)
      }
      const minted = BigInt(transfer.topics[3]!)
      setTokenCount((n) => Math.max(n ?? 0, Number(minted)))
      handleSelectToken(minted.toString())
      toast.success(t.toast.mintedTitle(minted.toString()), { description: t.toast.mintedBody })
    } catch (err: any) {
      const detail: string = err?.shortMessage || err?.message || t.toast.unknownError
      toast.error(t.toast.mintFailed, {
        description: /int8/i.test(detail) ? t.toast.weightsOutOfRange : detail.split("\n")[0],
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
                {t.header.title}
              </h1>
              <p className="text-xs text-muted-foreground">{t.header.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguagePicker />
            <NetworkPicker active={network} onChange={handleSelectNetwork} />
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </header>

        {contractState === "missing" && (
          <Banner tone="danger" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            {t.banner.missingContract(
              short(contractAddress),
              network?.chain.name ?? t.common.noNetwork,
              `NEXT_PUBLIC_CONTRACT_ADDRESS_${activeChainId}`
            )}
          </Banner>
        )}
        {contractState === "unconfigured" && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            {t.banner.unconfigured()}
          </Banner>
        )}
        {onWrongChain && (
          <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
            {isLocalNode ? (
              t.banner.localNode(nodeChainId!, chainId, network?.chain.name ?? t.common.noNetwork)
            ) : (
              <>
                {t.banner.wrongChain(chainId, networkLabel)}
                <button
                  onClick={() => switchChain({ chainId: expectedChainId! })}
                  className="ml-2 underline underline-offset-4 hover:no-underline"
                >
                  {t.banner.switchTo(networkLabel)}
                </button>
              </>
            )}
          </Banner>
        )}

        <main className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-medium">{t.canvas.title}</h2>
              <span className="text-xs text-muted-foreground">{t.canvas.range}</span>
            </div>

            <div className="mx-auto w-full max-w-[420px]">
              <CanvasBoard ref={canvasRef} brushSize={brush} onStrokeEnd={setPreview} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex flex-1 items-center gap-3 text-xs text-muted-foreground">
                {t.canvas.brush}
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
                {t.canvas.clear}
              </Button>
              <Button
                size="sm"
                onClick={handlePredict}
                disabled={predicting || contractState !== "ready"}
                className="gap-2 bg-violet-600 hover:bg-violet-700"
              >
                {predicting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {predicting ? t.canvas.predicting : t.canvas.predict}
              </Button>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">{t.canvas.readOnlyNote}</p>
          </section>

          <aside className="flex flex-col gap-6">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
              <h2 className="mb-4 font-medium">{t.prediction.title}</h2>
              <div className="flex items-center gap-5">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-black/40">
                  {predicting ? (
                    <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
                  ) : prediction !== null ? (
                    <span className="text-5xl font-semibold tabular-nums text-violet-300">{prediction}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t.common.none}</span>
                  )}
                </div>
                <div className="min-w-0 space-y-2 text-xs">
                  <Row
                    label={t.prediction.latency}
                    value={latency !== null ? t.prediction.ms(latency) : t.common.none}
                  />
                  <Row label={t.prediction.network} value={networkLabel} />
                  <Row label={t.prediction.token} value={`#${tokenId}`} />
                </div>
              </div>

              <div className="mt-5 border-t border-border/60 pt-4">
                <p className="mb-2 text-xs text-muted-foreground">{t.prediction.inputCaption}</p>
                <DigitPreview grid={preview} />
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
              <h2 className="mb-3 flex items-center gap-2 font-medium">
                <Cpu className="h-4 w-4 text-violet-400" />
                {t.model.title}
              </h2>
              {/* The model is the token, so everything below describes the
                  selected id -- read from its storage, not hardcoded. */}
              <label className="mb-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{t.model.token}</span>
                {tokenCount && tokenCount > 0 ? (
                  <select
                    value={tokenId}
                    onChange={(e) => handleSelectToken(e.target.value)}
                    className="rounded-lg border border-border/60 bg-black/40 px-2 py-1 font-mono text-xs outline-none focus:border-violet-400/60"
                  >
                    {Array.from({ length: tokenCount }, (_, i) => String(i + 1)).map((id) => (
                      <option key={id} value={id}>
                        #{id}
                        {id === DEFAULT_TOKEN_ID.toString() ? t.model.defaultSuffix : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-xs">#{tokenId}</span>
                )}
              </label>

              <div className="space-y-2 text-xs">
                <Row
                  label={t.model.architecture}
                  value={tokenModel ? describeArchitecture(tokenModel) : t.common.reading}
                />
                <Row
                  label={t.model.weights}
                  value={
                    tokenModel
                      ? t.model.weightsValue(tokenModel.weights.toLocaleString(), tokenModel.words)
                      : t.common.reading
                  }
                />
                <Row
                  label={t.model.biases}
                  value={tokenModel ? t.model.biasesValue(tokenModel.biases) : t.common.reading}
                />
                <Row
                  label={t.model.owner}
                  value={
                    tokenModel?.owner
                      ? short(tokenModel.owner)
                      : tokenModel
                        ? t.model.notMinted
                        : t.common.reading
                  }
                />
                <Row
                  label={t.model.accuracy}
                  value={tokenId === DEFAULT_TOKEN_ID.toString() ? "98.13%" : t.model.notMeasured}
                />
              </div>
              {tokenId !== DEFAULT_TOKEN_ID.toString() && (
                <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
                  {t.model.accuracyNote}
                </p>
              )}
              {network && (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a
                    href={explorerToken(network, tokenId) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-violet-400 hover:text-violet-300"
                  >
                    {t.model.tokenLink(tokenId)}
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
                  {t.mint.title}
                  <span className="text-xs text-muted-foreground group-open:hidden">
                    {t.mint.advanced}
                  </span>
                </span>
              </summary>

              <p className="mt-3 text-xs text-muted-foreground">{t.mint.intro()}</p>

              <Link
                href="/deploy"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-violet-300 hover:underline"
              >
                {t.mint.deployLink}
              </Link>

              <div className="mt-4 space-y-3">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs hover:border-violet-500/60 hover:bg-violet-500/5">
                  <Upload className="h-4 w-4" />
                  <span className="truncate">{modelFile ?? t.mint.choose}</span>
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
                        if (missing.length) throw new Error(t.toast.missingKeys(missing.join(", ")))
                        setModelParams(parsed)
                        setModelFile(file.name)
                        toast.success(t.toast.paramsLoaded)
                      } catch (err: any) {
                        setModelParams(null)
                        setModelFile(null)
                        toast.error(t.toast.readFileFailed, { description: err.message })
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
                  {!isConnected ? t.mint.connect : minting ? t.mint.minting : t.mint.submit}
                </Button>
              </div>
            </details>
          </aside>
        </main>

        <div className="mt-6 space-y-6">
          <ChainExecution
            run={run}
            network={network}
            networkLabel={networkLabel}
            latencyMs={latency}
            tokenId={BigInt(tokenId)}
            input={tracedInput}
            onStage={setActiveStage}
          />
          <InferenceTraceView
            input={tracedInput}
            run={run}
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
            {t.footer.source}
          </a>
        </footer>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {/* The label never wraps: it is two or three characters in Chinese, and
          breaking it mid-word to make room for the value reads as a typo. The
          value truncates instead. */}
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
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
