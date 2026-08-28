"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Database, Pause, Play } from "lucide-react"

import {
  loadStorageLayout,
  STAGES,
  type InferenceRun,
  type StageCost,
  type StageKey,
  type StorageLayout,
} from "@/lib/trace"
import { explorerAddress, type Network } from "@/lib/networks"
import { useT } from "@/lib/i18n"
import { usePublicClient } from "wagmi"

/** Monad's block gas limit -- the yardstick for "how big is this call". */
const MONAD_BLOCK_GAS_LIMIT = 150_000_000

const STAGE_COLOR: Record<StageKey, string> = {
  load: "#6d28d9",
  pack: "#38bdf8",
  conv1: "#a78bfa",
  pool1: "#22d3ee",
  conv2: "#c084fc",
  pool2: "#2dd4bf",
  flatten: "#34d399",
  fc: "#fbbf24",
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const gasLabel = (g: number) => (g >= 1e6 ? `${(g / 1e6).toFixed(2)}M` : g.toLocaleString())

/**
 * The forward pass as a gas budget.
 *
 * One bar, eight segments, width proportional to what each layer costs. There
 * is no call sequence to draw any more: MNISTPacked makes no external calls,
 * which is most of why it is cheap. What replaces the call timeline is a
 * measurement rather than a trace -- each segment is the difference between two
 * `eth_estimateGas` runs of the pipeline, so the widths are real gas, not a
 * model of it.
 */
function GasBar({
  stages,
  total,
  progress,
  cursor,
  onHover,
}: {
  stages: StageCost[]
  total: number
  /** Play head position, 0-1, in gas space. */
  progress: number
  cursor: number
  onHover: (index: number | null) => void
}) {
  const t = useT()
  return (
    <div className="relative">
      <div className="flex h-9 w-full overflow-hidden rounded-lg" onMouseLeave={() => onHover(null)}>
        {stages.map((s, i) => (
          <button
            key={s.key}
            onMouseEnter={() => onHover(i)}
            onFocus={() => onHover(i)}
            style={{
              width: `${(s.gas / total) * 100}%`,
              background: STAGE_COLOR[s.key],
              opacity: cursor === i ? 1 : 0.68,
            }}
            className="h-full min-w-[2px] border-0 transition-opacity"
            aria-label={`${t.execution.stageLabel[s.key]} ${s.gas} gas`}
          />
        ))}
      </div>
      <span
        className="pointer-events-none absolute top-0 h-9 w-[2px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
        style={{ left: `${progress * 100}%` }}
      />
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
  run,
  network,
  networkLabel,
  latencyMs,
  tokenId,
  input,
  onStage,
}: {
  run: InferenceRun | null
  /** Which deployment the run came from; undefined when none is configured. */
  network: Network | undefined
  networkLabel: string
  /** Measured wall-clock time of the inference call itself. */
  latencyMs: number | null
  tokenId: bigint
  /** The 28x28 grid that produced this run. */
  input: number[][] | null
  onStage?: (stage: StageKey | null) => void
}) {
  const t = useT()
  const publicClient = usePublicClient()
  const [progress, setProgress] = useState(1)
  /** Storage layout, also on demand -- it costs one more traced execution. */
  const [layout, setLayout] = useState<StorageLayout | null>(null)
  const [loadingLayout, setLoadingLayout] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const raf = useRef<number | null>(null)

  // A new run replays itself. Nobody should have to press play to see the
  // thing they just ran.
  useEffect(() => {
    if (!run) return
    setProgress(0)
    setPlaying(true)
  }, [run])

  const realMs = latencyMs ?? 0
  /** The replay runs for exactly as long as the call itself took. */
  const replayMs = Math.max(realMs, 1)

  useEffect(() => {
    if (!playing || !run) return
    let start: number | null = null
    const from = progress >= 1 ? 0 : progress
    const tick = (now: number) => {
      if (start === null) start = now
      const at = from + (now - start) / replayMs
      if (at >= 1) {
        setProgress(1)
        setPlaying(false)
        return
      }
      setProgress(at)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
    // `progress` is the seek position at the moment play starts, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, replayMs])

  const stageGas = useMemo(
    () => (run?.stages ?? []).reduce((sum, s) => sum + s.gas, 0),
    [run]
  )

  const playhead = useMemo(() => {
    const stages = run?.stages ?? []
    if (!stages.length) return 0
    const at = progress * stageGas
    const i = stages.findIndex((s) => at < s.gasBefore + s.gas)
    return i === -1 ? stages.length - 1 : i
  }, [run, progress, stageGas])

  const cursor = hovered ?? playhead
  const current: StageCost | null = run?.stages[cursor] ?? null

  useEffect(() => {
    onStage?.(current?.key ?? null)
  }, [current, onStage])

  // No network means no run to replay, and nothing here to address.
  if (!run || !network) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
        <h2 className="font-medium">{t.execution.title}</h2>
        <p className="py-8 text-center text-sm text-muted-foreground">{t.execution.empty}</p>
      </section>
    )
  }

  const gasKnown = run.gasTotal !== null
  const gasShown = run.gasTotal ?? stageGas
  const blockShare = (gasShown / MONAD_BLOCK_GAS_LIMIT) * 100

  return (
    <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t.execution.title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {t.execution.blockLabel(networkLabel, run.blockNumber.toString())}
        </span>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        {t.execution.summary(gasLabel(gasShown), blockShare.toFixed(1))}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">{t.execution.replayNote(realMs)}</p>

      <div className="mb-4 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3">
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span className="truncate text-xs font-medium">MNISTPacked</span>
          <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-400" />
        </div>
        <a
          href={explorerAddress(network, run.contract) ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block font-mono text-[10px] text-violet-300/70 hover:text-violet-300"
        >
          {short(run.contract)}
        </a>
        <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
          {t.execution.role.MNISTPacked}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[10px] text-muted-foreground sm:grid-cols-4">
          <div className="flex justify-between gap-2">
            <dt>{t.execution.card.callsIn}</dt>
            <dd className="text-foreground/80">1</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t.execution.card.externalCalls}</dt>
            <dd className="text-foreground/80">0</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t.execution.card.gas}</dt>
            <dd className="text-foreground/80">{gasKnown ? gasLabel(gasShown) : t.common.none}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t.execution.card.storageRead}</dt>
            <dd className="text-foreground/80">
              {layout ? t.execution.card.words(layout.slots.length) : t.common.none}
            </dd>
          </div>
        </dl>
      </div>

      {run.stages.length === 0 ? (
        <p className="rounded-lg border border-border/60 bg-black/30 px-3 py-4 text-center text-xs text-muted-foreground">
          {t.execution.noEstimate}
        </p>
      ) : (
        <>
          <p className="mb-1.5 font-mono text-[10px] text-muted-foreground">{t.execution.axisGas}</p>
          <GasBar
            stages={run.stages}
            total={stageGas}
            progress={progress}
            cursor={cursor}
            onHover={setHovered}
          />

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {run.stages.map((s, i) => (
              <span
                key={s.key}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                  cursor === i ? "bg-violet-500/25 text-violet-200" : "text-muted-foreground"
                }`}
              >
                <span className="h-2 w-2 rounded-[2px]" style={{ background: STAGE_COLOR[s.key] }} />
                {t.execution.stageLabel[s.key]} · {gasLabel(s.gas)}
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
            <span className="font-mono text-[11px] text-muted-foreground">
              {hovered !== null ? t.execution.hover : t.execution.step}{" "}
              {t.execution.position(cursor + 1, run.stages.length)}
            </span>
          </div>

          {current && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-black/30 px-3 py-2 font-mono text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: STAGE_COLOR[current.key] }} />
                <span className="text-foreground">{t.execution.stageLabel[current.key]}</span>
              </span>
              <span className="text-muted-foreground">
                {t.execution.stageGas(current.gas.toLocaleString())}
              </span>
              <span className="text-violet-300">
                {((current.gas / stageGas) * 100).toFixed(1)}%
              </span>
              <span className="ml-auto text-muted-foreground">
                {t.execution.gasOfTotal(gasLabel(current.gasBefore + current.gas), gasLabel(stageGas))}
              </span>
              <span className="text-muted-foreground/70">
                {t.execution.msInto(
                  (((current.gasBefore + current.gas) / stageGas) * realMs).toFixed(0),
                  realMs
                )}
              </span>
            </div>
          )}

        </>
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t.execution.weightsFrom("MNISTPacked")}</p>
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

export { STAGES }
