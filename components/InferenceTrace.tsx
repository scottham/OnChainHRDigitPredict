"use client"

import { ChevronRight, Loader2, Radio } from "lucide-react"

import FeatureMap from "@/components/FeatureMap"
import { useT } from "@/lib/i18n"
import type { InferenceRun, StageKey } from "@/lib/trace"

/**
 * One stage of the strip. `active` is driven by the execution replay above, so
 * the layer lights up while the call that produced it is on the play head.
 */
function StageColumn({
  label,
  shape,
  active,
  children,
}: {
  label: string
  shape: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex shrink-0 flex-col items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
        active ? "bg-violet-500/15 ring-1 ring-violet-400/50" : ""
      }`}
    >
      <div className="text-center">
        <div className={`text-xs font-medium ${active ? "text-violet-200" : ""}`}>{label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{shape}</div>
      </div>
      {children}
    </div>
  )
}

function Arrow({ op }: { op: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 self-center px-1">
      <ChevronRight className="h-4 w-4 text-violet-500/60" />
      <span className="font-mono text-[10px] text-muted-foreground">{op}</span>
    </div>
  )
}

/** Column of channels for one layer. */
function Channels({ maps, size }: { maps: number[][][]; size: number }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1">
      {maps.map((m, i) => (
        <FeatureMap key={i} data={m} size={size} title={t.trace.channel(i)} />
      ))}
    </div>
  )
}

function Logits({ logits, prediction }: { logits: number[]; prediction: number }) {
  const min = Math.min(...logits)
  const max = Math.max(...logits)
  const span = max - min || 1

  return (
    <div className="flex flex-col gap-[3px]">
      {logits.map((v, digit) => {
        const width = ((v - min) / span) * 100
        const isTop = digit === prediction
        return (
          <div key={digit} className="flex items-center gap-1.5">
            <span
              className={`w-2 text-right font-mono text-[10px] ${
                isTop ? "text-violet-300" : "text-muted-foreground"
              }`}
            >
              {digit}
            </span>
            <div className="h-2.5 w-24 overflow-hidden rounded-sm bg-black/40">
              <div
                className={`h-full rounded-sm ${isTop ? "bg-violet-400" : "bg-violet-900"}`}
                style={{ width: `${Math.max(width, 2)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function InferenceTraceView({
  input,
  run,
  loading,
  error,
  activeStage,
}: {
  input: number[][] | null
  run: InferenceRun | null
  loading: boolean
  error: string | null
  activeStage?: StageKey | null
}) {
  const t = useT()

  return (
    <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t.trace.title}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-300">
          <Radio className="h-3 w-3" />
          {t.trace.badge}
        </span>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">{t.trace.intro()}</p>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.trace.loading}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      {run && !loading && (
        <>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3">
            <StageColumn label={t.trace.input} shape="1×28×28">
              {input && <FeatureMap data={input} size={72} />}
            </StageColumn>

            <Arrow op="conv 3×3" />
            <StageColumn label="conv1 + ReLU" shape="3×28×28" active={activeStage === "conv1"}>
              <Channels maps={run.conv1} size={44} />
            </StageColumn>

            <Arrow op="maxpool 2" />
            <StageColumn label="pool1" shape="3×14×14" active={activeStage === "pool1"}>
              <Channels maps={run.pool1} size={44} />
            </StageColumn>

            <Arrow op="conv 3×3" />
            <StageColumn label="conv2 + ReLU" shape="6×14×14" active={activeStage === "conv2"}>
              <Channels maps={run.conv2} size={26} />
            </StageColumn>

            <Arrow op="maxpool 2" />
            <StageColumn label="pool2" shape="6×7×7" active={activeStage === "pool2"}>
              <Channels maps={run.pool2} size={26} />
            </StageColumn>

            <Arrow op="flatten → fc" />
            <StageColumn label="logits" shape="10" active={activeStage === "flatten" || activeStage === "fc"}>
              <Logits logits={run.logits} prediction={run.prediction} />
            </StageColumn>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
            <span>{t.trace.noExternalCalls}</span>
            {run.gasTotal !== null && (
              <span>{t.trace.gasTotal((run.gasTotal / 1e6).toFixed(2) + "M")}</span>
            )}
            <span title={t.trace.elapsedTitle}>{t.trace.elapsed(run.elapsedMs)}</span>
          </div>
        </>
      )}

      {!run && !loading && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.trace.empty}</p>
      )}
    </section>
  )
}
