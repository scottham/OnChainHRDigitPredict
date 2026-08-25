"use client"

import { ChevronRight, Loader2, Radio } from "lucide-react"

import FeatureMap from "@/components/FeatureMap"
import type { InferenceTrace } from "@/lib/trace"

function Stage({
  label,
  shape,
  children,
}: {
  label: string
  shape: string
  children: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="text-center">
        <div className="text-xs font-medium">{label}</div>
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
  return (
    <div className="flex flex-col gap-1">
      {maps.map((m, i) => (
        <FeatureMap key={i} data={m} size={size} title={`channel ${i}`} />
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
  trace,
  loading,
  error,
}: {
  input: number[][] | null
  trace: InferenceTrace | null
  loading: boolean
  error: string | null
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Execution trace</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-300">
          <Radio className="h-3 w-3" />
          measured on-chain
        </span>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Every activation below is the actual return value of an on-chain call, read back with{" "}
        <code className="font-mono">debug_traceCall</code>. Nothing here is recomputed in the browser.
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Tracing execution…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      {trace && !loading && (
        <>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3">
            <Stage label="Input" shape="1×28×28">
              {input && <FeatureMap data={input} size={72} />}
            </Stage>

            <Arrow op="conv 3×3" />
            <Stage label="conv1 + ReLU" shape="3×28×28">
              <Channels maps={trace.conv1} size={44} />
            </Stage>

            <Arrow op="maxpool 2" />
            <Stage label="pool1" shape="3×14×14">
              <Channels maps={trace.pool1} size={44} />
            </Stage>

            <Arrow op="conv 3×3" />
            <Stage label="conv2 + ReLU" shape="6×14×14">
              <Channels maps={trace.conv2} size={26} />
            </Stage>

            <Arrow op="maxpool 2" />
            <Stage label="pool2" shape="6×7×7">
              <Channels maps={trace.pool2} size={26} />
            </Stage>

            <Arrow op="flatten → fc" />
            <Stage label="logits" shape="10">
              <Logits logits={trace.logits} prediction={trace.prediction} />
            </Stage>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
            <span>{trace.totalCalls.toLocaleString()} external calls</span>
            <span>{trace.callCounts.relu?.toLocaleString()} × relu()</span>
            <span>{(trace.traceBytes / 1024 / 1024).toFixed(2)} MB trace</span>
            <span>{trace.elapsedMs} ms</span>
          </div>
        </>
      )}

      {!trace && !loading && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Run a prediction to see the layer-by-layer execution.
        </p>
      )}
    </section>
  )
}
