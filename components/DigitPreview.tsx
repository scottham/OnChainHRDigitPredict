"use client"

import { useEffect, useRef } from "react"

/**
 * Renders the exact 28x28 grid that gets sent to the contract, so the gap
 * between what was drawn and what the model sees is visible rather than
 * guessed at.
 */
export default function DigitPreview({ grid }: { grid: number[][] | null }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (!ctx) return

    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, 28, 28)
    if (!grid) return

    const image = ctx.createImageData(28, 28)
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        const v = grid[y][x]
        const i = (y * 28 + x) * 4
        image.data[i] = v
        image.data[i + 1] = v
        image.data[i + 2] = v
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [grid])

  return (
    <canvas
      ref={ref}
      width={28}
      height={28}
      className="h-24 w-24 rounded-lg border border-border/60 bg-black"
      style={{ imageRendering: "pixelated" }}
    />
  )
}
