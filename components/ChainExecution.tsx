"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Cpu, Database, Pause, Play } from "lucide-react"

import {
  loadStorageLayout,
  measureStageTimes,
  type CallRecord,
  type InferenceTrace,
  type Stage,
  type StorageLayout,
} from "@/lib/trace"
import { explorerAddress, type Network } from "@/lib/networks"
import { useT, type Messages } from "@/lib/i18n"
import { usePublicClient } from "wagmi"

/** Monad's block gas limit -- the yardstick for "how big is this call". */
const MONAD_BLOCK_GAS_LIMIT = 150_000_000

const FN_COLOR: Record<CallRecord["fn"], string> = {
  conv2D: "#a78bfa",
  maxPool2D: "#38bdf8",
  flatten3D: "#34d399",
  fullyConnected: "#fbbf24",
  relu: "#6d28d9",
  argmax: "#f472b6",
}



const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * The translated role for a contract, or undefined when the trace's own
 * English wording should stand (the other two roles are lists of function
 * names, which no locale translates).
 */
function roleFor(t: Messages, label: string): string | undefined {
  return label in t.execution.role ? t.execution.role[label as keyof Messages["execution"]["role"]] : undefined
}
const gasLabel = (g: number) => (g >= 1e6 ? `${(g / 1e6).toFixed(2)}M` : g.toLocaleString())

/** Index of the call executing at `gas` gas into the run. */
function callAtGas(calls: CallRecord[], gas: number) {
  let lo = 0
  let hi = calls.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (calls[mid].gasBefore <= gas) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Two views of the same call sequence, drawn to one canvas.
 *
 * Top strip: x is gas. Bottom strip: x is call index. They look nothing alike,
 * which is the point -- 99.8% of the calls are relu, and they cost 1.5% of the
 * gas. Lane (row) is the contract that received the call.
 */
function Strips({
  trace,
  progress,
  cursor,
  onHover,
}: {
  trace: InferenceTrace
  /** Play head position, 0-1, in gas space. */
  progress: number
  /** Index of the call under the play head or the mouse. */
  cursor: number
  onHover: (index: number | null) => void
}) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const LANE_H = 22
  const GAP = 6
  const BLOCK_H = LANE_H * 2 + GAP
  const HEIGHT = BLOCK_H * 2 + 44
  /** Gutter holding the lane (callee contract) labels. */
  const PAD = 88
  const plot = Math.max(width - PAD, 1)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx || !width) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = HEIGHT * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    const convAddress = trace.contracts[1].address.toLowerCase()
    const laneOf = (c: CallRecord) => (c.to.toLowerCase() === convAddress ? 0 : 1)

    const drawLane = (top: number, axis: string) => {
      ctx.fillStyle = "rgba(255,255,255,0.035)"
      ctx.fillRect(PAD, top, plot, LANE_H)
      ctx.fillRect(PAD, top + LANE_H + GAP, plot, LANE_H)

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace"
      ctx.textBaseline = "middle"
      ctx.fillStyle = "rgba(255,255,255,0.45)"
      ctx.fillText("Convolution2D", 0, top + LANE_H / 2)
      ctx.fillText("FullyConnected", 0, top + LANE_H + GAP + LANE_H / 2)
      ctx.fillStyle = "rgba(255,255,255,0.3)"
      ctx.fillText(axis, 0, top - 9)
    }

    // Strip 1 -- gas as the x axis.
    drawLane(12, t.execution.axisGas)
    for (const call of trace.calls) {
      const x = PAD + (call.gasBefore / trace.gasCalls) * plot
      const w = (call.gas / trace.gasCalls) * plot
      ctx.fillStyle = FN_COLOR[call.fn]
      ctx.fillRect(x, 12 + laneOf(call) * (LANE_H + GAP), Math.max(w, 0.35), LANE_H)
    }

    // Strip 2 -- call index as the x axis. Same calls, unrecognizably different
    // shape: relu is 99.8% of the calls and 1.5% of the gas.
    const top = BLOCK_H + 38
    drawLane(top, t.execution.axisIndex)
    const step = plot / trace.calls.length
    trace.calls.forEach((call, i) => {
      ctx.fillStyle = FN_COLOR[call.fn]
      // A structural call is one 3,535th of the width -- invisible. Widen those
      // to a 2px tick so the layer boundaries can be seen; relu stays exact,
      // since its share of the width is the whole point of this strip.
      const w = call.fn === "relu" ? Math.max(step, 0.35) : Math.max(step, 2)
      ctx.fillRect(PAD + i * step, top + laneOf(call) * (LANE_H + GAP), w, LANE_H)
    })
  }, [trace, width, HEIGHT, BLOCK_H, plot, t])

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const t = Math.min(Math.max((e.clientX - rect.left - PAD) / (rect.width - PAD), 0), 0.999999)
      const y = e.clientY - rect.top
      onHover(y > BLOCK_H + 25 ? Math.floor(t * trace.calls.length) : callAtGas(trace.calls, t * trace.gasCalls))
    },
    [onHover, trace, BLOCK_H, PAD]
  )

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      <canvas ref={canvasRef} className="block rounded" />
      {/* Play heads: gas space on the top strip, call index on the bottom one. */}
      <span
        className="pointer-events-none absolute w-[2px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
        style={{ left: `calc(${PAD}px + ${progress} * (100% - ${PAD}px))`, top: 12, height: BLOCK_H }}
      />
      <span
        className="pointer-events-none absolute w-[2px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
        style={{
          left: `calc(${PAD}px + ${cursor / trace.calls.length} * (100% - ${PAD}px))`,
          top: BLOCK_H + 38,
          height: BLOCK_H,
        }}
      />
    </div>
  )
}

function ContractCard({
  contract,
  network,
  active,
  isHolder,
  slots,
  codeBytes,
}: {
  contract: InferenceTrace["contracts"][number]
  network: Network
  active: boolean
  /** The contract the weights live in. */
  isHolder: boolean
  /** Null until the storage layout has been loaded. */
  slots: number | null
  codeBytes: number | null
}) {
  const t = useT()
  /**
   * The trace labels each contract with a role in English. Where a locale has
   * its own wording for that role it wins; the function lists ("conv2D ·
   * maxPool2D") are identifiers, so they fall through untranslated.
   */
  const role = roleFor(t, contract.label) ?? contract.role

  return (
    <div
      className={`min-w-0 flex-1 rounded-xl border p-3 transition-colors ${
        active ? "border-violet-400/70 bg-violet-500/10" : "border-border/60 bg-black/20"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {isHolder ? (
          <Database className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        ) : (
          <Cpu className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        )}
        <span className="truncate text-xs font-medium">{contract.label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-400" />}
      </div>
      <a
        href={explorerAddress(network, contract.address) ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 block font-mono text-[10px] text-violet-300/70 hover:text-violet-300"
      >
        {short(contract.address)}
      </a>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{role}</p>
      <dl className="mt-2 space-y-0.5 font-mono text-[10px] text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t.execution.card.callsIn}</dt>
          <dd className="text-foreground/80">{contract.calls.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{isHolder ? t.execution.card.selfGas : t.execution.card.gas}</dt>
          <dd className="text-foreground/80">
            {isHolder && contract.gas <= 0 ? t.common.none : gasLabel(contract.gas)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{isHolder ? t.execution.card.storageRead : t.execution.card.code}</dt>
          <dd className="text-foreground/80">
            {isHolder
              ? slots === null
                ? t.common.none
                : t.execution.card.words(slots)
              : codeBytes === null
                ? t.common.none
                : t.execution.card.kilobytes((codeBytes / 1024).toFixed(1))}
          </dd>
        </div>
      </dl>
    </div>
  )
}

/** The weight slots, one square per 256-bit storage word actually read. */
function StorageGrid({ slots }: { slots: string[] }) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div>
      <div className="flex flex-wrap gap-[3px]">
        {slots.map((slot, i) => (
          <span
            key={slot}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="h-2.5 w-2.5 rounded-[2px] bg-violet-500/50 transition-colors hover:bg-violet-300"
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        {hover === null
          ? t.execution.slotsRead(slots.length)
          : t.execution.slotDetail(hover, slots[hover].slice(0, 18), slots[hover].slice(-6))}
      </p>
    </div>
  )
}

export default function ChainExecution({
  trace,
  network,
  networkLabel,
  latencyMs,
  tokenId,
  input,
  onStage,
}: {
  trace: InferenceTrace | null
  /** Which deployment the trace came from; undefined when none is configured. */
  network: Network | undefined
  networkLabel: string
  /** Measured wall-clock time of the inference call itself. */
  latencyMs: number | null
  tokenId: bigint
  /** The 28x28 grid that produced this trace. */
  input: number[][] | null
  onStage?: (stage: Stage["key"] | null) => void
}) {
  const t = useT()
  const publicClient = usePublicClient()
  const [progress, setProgress] = useState(1)
  /** Measured wall-clock per layer, filled in on demand. */
  const [stageTimes, setStageTimes] = useState<(number | null)[] | null>(null)
  const [measuring, setMeasuring] = useState(false)
  /** Storage layout, also on demand -- it costs one more traced execution. */
  const [layout, setLayout] = useState<StorageLayout | null>(null)
  const [loadingLayout, setLoadingLayout] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const raf = useRef<number | null>(null)

  // A new trace replays itself. Nobody should have to press play to see the
  // thing they just ran.
  useEffect(() => {
    if (!trace) return
    setProgress(0)
    setPlaying(true)
    setStageTimes(null)
  }, [trace])

  const realMs = latencyMs ?? 0
  /** The replay runs for exactly as long as the call itself took. */
  const replayMs = Math.max(realMs, 1)

  useEffect(() => {
    if (!playing || !trace) return
    let start: number | null = null
    const from = progress >= 1 ? 0 : progress
    const tick = (now: number) => {
      if (start === null) start = now
      const t = from + (now - start) / replayMs
      if (t >= 1) {
        setProgress(1)
        setPlaying(false)
        return
      }
      setProgress(t)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
    // `progress` is the seek position at the moment play starts, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, trace, replayMs])

  const playhead = useMemo(() => {
    if (!trace) return 0
    return callAtGas(trace.calls, progress * trace.gasCalls)
  }, [trace, progress])

  const cursor = hovered ?? playhead
  const current = trace?.calls[cursor] ?? null

  const stage = useMemo(() => {
    if (!trace) return null
    return trace.stages.find((s) => cursor >= s.from && cursor <= s.to) ?? null
  }, [trace, cursor])

  useEffect(() => {
    onStage?.(stage?.key ?? null)
  }, [stage, onStage])

  // No network means no trace to replay, and nothing here to address.
  if (!trace || !network) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
        <h2 className="font-medium">{t.execution.title}</h2>
        <p className="py-8 text-center text-sm text-muted-foreground">{t.execution.empty}</p>
      </section>
    )
  }

  const gasCursor = current ? current.gasBefore + current.gas : 0
  // Fall back to the sum over the external calls when the node will not report
  // a trustworthy total; that sum is a floor, hence the "at least".
  const gasKnown = trace.gasTotal !== null
  const gasShown = trace.gasTotal ?? trace.gasCalls
  const blockShare = (gasShown / MONAD_BLOCK_GAS_LIMIT) * 100
  const convAddress = trace.contracts[1].address.toLowerCase()
  const activeAddress = current?.to.toLowerCase()

  return (
    <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t.execution.title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {t.execution.blockLabel(networkLabel, trace.blockNumber.toString())}
        </span>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        {t.execution.summary(
          trace.totalCalls.toLocaleString(),
          trace.contracts.length,
          gasLabel(gasShown),
          !gasKnown,
          blockShare.toFixed(0)
        )}
        {!gasKnown && t.execution.gasUnknownNote()}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">{t.execution.replayNote(realMs)}</p>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <ContractCard
          contract={trace.contracts[0]}
          network={network}
          active={false}
          isHolder
          slots={layout ? layout.slots.length : null}
          codeBytes={null}
        />
        <div className="flex shrink-0 items-center justify-center px-1 sm:flex-col sm:justify-center">
          <ArrowRight className="h-4 w-4 text-violet-500/60" />
        </div>
        <ContractCard
          contract={trace.contracts[1]}
          network={network}
          active={activeAddress === convAddress}
          isHolder={false}
          slots={null}
          codeBytes={layout?.codeBytes[convAddress] ?? null}
        />
        <ContractCard
          contract={trace.contracts[2]}
          network={network}
          active={!!activeAddress && activeAddress !== convAddress}
          isHolder={false}
          slots={null}
          codeBytes={layout?.codeBytes[trace.contracts[2].address.toLowerCase()] ?? null}
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {trace.stages.map((s, i) => (
          <span
            key={s.key}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              stage?.key === s.key ? "bg-violet-500/25 text-violet-200" : "text-muted-foreground"
            }`}
          >
            {s.label} · {gasLabel(s.gas)}
            {stageTimes?.[i] != null && (
              <span className="text-emerald-300/90"> · {stageTimes[i]} ms</span>
            )}
          </span>
        ))}
      </div>

      <Strips trace={trace} progress={progress} cursor={cursor} onHover={setHovered} />

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(FN_COLOR) as CallRecord["fn"][]).map((fn) => (
          <span key={fn} className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: FN_COLOR[fn] }} />
            {fn}
            {trace.callCounts[fn] > 1 ? ` ×${trace.callCounts[fn].toLocaleString()}` : ""}
          </span>
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        onChange={(e) => {
          setPlaying(false)
          setProgress(Number(e.target.value) / 1000)
        }}
        className="mt-3 w-full accent-violet-500"
        aria-label={t.execution.seekLabel}
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-black/30 px-2.5 py-1 text-xs hover:border-violet-400/60"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? t.execution.pause : progress >= 1 ? t.execution.replay(realMs) : t.execution.play}
        </button>
        <button
          onClick={async () => {
            if (!publicClient) return
            setMeasuring(true)
            try {
              setStageTimes(await measureStageTimes(publicClient, trace))
            } finally {
              setMeasuring(false)
            }
          }}
          disabled={measuring}
          className="rounded-lg border border-border/60 bg-black/30 px-2.5 py-1 text-xs hover:border-emerald-400/60 disabled:opacity-50"
        >
          {measuring
            ? t.execution.timing
            : stageTimes
              ? t.execution.retime
              : t.execution.timeLayers}
        </button>
        <span className="font-mono text-[11px] text-muted-foreground">
          {hovered !== null ? t.execution.hover : t.execution.step}{" "}
          {t.execution.position(
            (cursor + 1).toLocaleString(),
            trace.calls.length.toLocaleString()
          )}
        </span>
      </div>

      {current && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-black/30 px-3 py-2 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: FN_COLOR[current.fn] }} />
            <span className="text-foreground">{current.fn}()</span>
          </span>
          <span className="text-muted-foreground">{current.type}</span>
          <span className="text-violet-300">→ {short(current.to)}</span>
          <span className="text-muted-foreground">
            {t.execution.callGas(current.gas.toLocaleString())}
          </span>
          <span className="ml-auto text-muted-foreground">
            {t.execution.gasOfTotal(gasLabel(gasCursor), gasLabel(trace.gasCalls))}
          </span>
          <span className="text-muted-foreground/70">
            {t.execution.msInto(((gasCursor / trace.gasCalls) * realMs).toFixed(0), realMs)}
          </span>
        </div>
      )}

      {stageTimes && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t.execution.stageTimesNote(realMs)}
        </p>
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t.execution.weightsFrom(trace.contracts[0].label)}
          </p>
          {!layout && (
            <button
              onClick={async () => {
                if (!publicClient || !input) return
                setLoadingLayout(true)
                try {
                  setLayout(await loadStorageLayout(publicClient, network.contract, tokenId, input))
                } catch {
                  setLayoutError(t.execution.noPrestate)
                } finally {
                  setLoadingLayout(false)
                }
              }}
              disabled={loadingLayout || !input}
              className="rounded-lg border border-border/60 bg-black/30 px-2.5 py-1 text-xs hover:border-violet-400/60 disabled:opacity-50"
            >
              {loadingLayout ? t.execution.loadingLayout : t.execution.showStorage}
            </button>
          )}
        </div>
        {layout ? (
          <StorageGrid slots={layout.slots} />
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground">
            {layoutError ?? t.execution.storageHint}
          </p>
        )}
      </div>
    </section>
  )
}
