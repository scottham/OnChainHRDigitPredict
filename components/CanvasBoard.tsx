"use client"

import { useRef, useImperativeHandle, forwardRef, useEffect, useCallback } from "react"

/** Logical model input size. */
const GRID = 28
/** MNIST normalizes the digit into a 20x20 box before centering it in 28x28. */
const FIT = 20
/** Drawing surface resolution; downsampled to GRID before inference. */
const DRAW = 336

export type CanvasBoardHandle = {
  clearCanvas: () => void
  /** 28x28 grayscale, 0-255, preprocessed the way MNIST was. */
  getProcessedInput: () => number[][] | null
  isEmpty: () => boolean
}

type Props = {
  brushSize?: number
  onStrokeEnd?: (preview: number[][] | null) => void
}

const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(({ brushSize = 24, onStrokeEnd }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const brush = useRef(brushSize)

  useEffect(() => {
    brush.current = brushSize
  }, [brushSize])

  const reset = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, DRAW, DRAW)
  }, [])

  useEffect(() => {
    reset()
  }, [reset])

  /**
   * Downsample the drawing to 28x28 the way MNIST was built: crop to the ink,
   * scale the longer side to 20px preserving aspect, then place it so the
   * digit's centre of mass sits at the centre of the 28x28 field.
   *
   * Skipping this is why raw canvas input misclassifies so often -- the model
   * only ever saw centred, size-normalized digits.
   */
  const getProcessedInput = useCallback((): number[][] | null => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d", { willReadFrequently: true })
    if (!canvas || !ctx) return null

    const src = ctx.getImageData(0, 0, DRAW, DRAW)

    // Ink bounding box, using the red channel (strokes are pure white).
    let minX = DRAW, minY = DRAW, maxX = -1, maxY = -1
    for (let y = 0; y < DRAW; y++) {
      for (let x = 0; x < DRAW; x++) {
        if (src.data[(y * DRAW + x) * 4] > 12) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null // nothing drawn

    const boxW = maxX - minX + 1
    const boxH = maxY - minY + 1
    const scale = FIT / Math.max(boxW, boxH)
    const dstW = Math.max(1, Math.round(boxW * scale))
    const dstH = Math.max(1, Math.round(boxH * scale))

    // Scale the cropped digit into a small offscreen buffer.
    const off = document.createElement("canvas")
    off.width = dstW
    off.height = dstH
    const offCtx = off.getContext("2d", { willReadFrequently: true })!
    offCtx.imageSmoothingEnabled = true
    offCtx.imageSmoothingQuality = "high"
    offCtx.drawImage(canvas, minX, minY, boxW, boxH, 0, 0, dstW, dstH)
    const scaled = offCtx.getImageData(0, 0, dstW, dstH)

    // Centre of mass of the scaled digit.
    let mass = 0, cx = 0, cy = 0
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const v = scaled.data[(y * dstW + x) * 4]
        mass += v
        cx += x * v
        cy += y * v
      }
    }
    if (mass === 0) return null
    cx /= mass
    cy /= mass

    // Offset so that centre of mass lands on the middle of the 28x28 field.
    const offsetX = Math.round(GRID / 2 - cx)
    const offsetY = Math.round(GRID / 2 - cy)

    const grid: number[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(0))
    for (let y = 0; y < dstH; y++) {
      const ty = y + offsetY
      if (ty < 0 || ty >= GRID) continue
      for (let x = 0; x < dstW; x++) {
        const tx = x + offsetX
        if (tx < 0 || tx >= GRID) continue
        grid[ty][tx] = scaled.data[(y * dstW + x) * 4]
      }
    }
    return grid
  }, [])

  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      reset()
      onStrokeEnd?.(null)
    },
    getProcessedInput,
    isEmpty: () => getProcessedInput() === null,
  }))

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * DRAW,
      y: ((e.clientY - rect.top) / rect.height) * DRAW,
    }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawing.current = true
    const { x, y } = pos(e)
    ctx.strokeStyle = "#ffffff"
    ctx.fillStyle = "#ffffff"
    ctx.lineWidth = brush.current
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A single tap should leave a dot, not nothing.
    ctx.arc(x, y, brush.current / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    onStrokeEnd?.(getProcessedInput())
  }

  return (
    <canvas
      ref={canvasRef}
      width={DRAW}
      height={DRAW}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      className="aspect-square w-full touch-none rounded-xl bg-black cursor-crosshair select-none"
    />
  )
})

CanvasBoard.displayName = "CanvasBoard"

export default CanvasBoard
