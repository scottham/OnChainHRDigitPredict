"use client"

import { useEffect, useRef } from "react"

/**
 * One activation channel, drawn at its true resolution and scaled up with
 * nearest-neighbour so individual units stay visible.
 *
 * Values are normalized per-map: activations carry the network's accumulated
 * scale factor (~1e13 by the fc layer), so absolute magnitudes are meaningless
 * to the eye. Relative structure within a channel is the informative part.
 */
export default function FeatureMap({
  data,
  size = 56,
  title,
}: {
  data: number[][]
  size?: number
  title?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const h = data.length
    const w = data[0].length
    canvas.width = w
    canvas.height = h

    let min = Infinity
    let max = -Infinity
    for (const row of data) {
      for (const v of row) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    const span = max - min || 1

    const image = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = (data[y][x] - min) / span
        const i = (y * w + x) * 4
        // Dark navy -> violet -> near-white ramp, matching the page accent.
        image.data[i] = Math.round(18 + t * (196 - 18))
        image.data[i + 1] = Math.round(20 + t * (168 - 20))
        image.data[i + 2] = Math.round(38 + t * (255 - 38))
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [data])

  return (
    <canvas
      ref={ref}
      title={title}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      className="rounded border border-border/40"
    />
  )
}
