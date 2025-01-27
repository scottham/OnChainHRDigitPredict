"use client"

import type React from "react"
import { useRef, useImperativeHandle, forwardRef, useEffect } from "react"

const CanvasBoard = forwardRef((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)

  const initializeCanvas = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.lineWidth = 1
        ctx.lineCap = "round"
        ctx.strokeStyle = "#000000"
      }
    }
  }

  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
    },
    getCanvasData: () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext("2d")
        if (ctx) {
          return ctx.getImageData(0, 0, canvas.width, canvas.height)
        }
      }
      return null
    },
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.scale(1, 1) // Reset scale
        ctx.scale(canvas.width / 28, canvas.height / 28) // Set scale to match 28x28 logical size
      }
    }
    initializeCanvas()
  }, [])

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        ctx.beginPath()
        ctx.moveTo(x, y)
      }
    }
  }

  const stopDrawing = () => {
    isDrawing.current = false
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return

    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        ctx.lineTo(x, y)
        ctx.stroke()
      }
    }
  }

  return (
    <div className="relative w-[280px] h-[280px]">
      <canvas
        ref={canvasRef}
        width={28}
        height={28}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseMove={draw}
        onMouseOut={stopDrawing}
        className="absolute top-0 left-0 w-full h-full border border-gray-300 cursor-crosshair"
        style={{
          imageRendering: "pixelated",
        }}
      />
    </div>
  )
})

CanvasBoard.displayName = "CanvasBoard"

export default CanvasBoard

