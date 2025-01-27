"use client"

import { useRef, useState } from "react"
import { ethers } from "ethers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import CanvasBoard from "@/components/CanvasBoard"
import { CONTRACT_ADDRESS, CONTRACT_ABI, RPC_URL } from "@/lib/contractConfig"
import Image from "next/image"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"

export default function Page() {
  const canvasRef = useRef<any>(null)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [inferenceTime, setInferenceTime] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clearCanvas()
    }
    setPrediction(null)
    setInferenceTime(null)
  }

  const handlePredict = async () => {
    if (!canvasRef.current) return

    const imgData = canvasRef.current.getCanvasData()
    console.log(imgData)
    const downsampled = downsampleTo16x16(imgData)
    const input256 = downsampled.map((v: number) => Math.round(v))
    console.log(input256)
    try {
      setIsLoading(true)
      setPrediction(null)
      setInferenceTime(null)

      const provider = new ethers.providers.JsonRpcProvider(RPC_URL)

      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider)

      const startTime = performance.now()
      const result = await contract.predictDigit(1, input256)
      const endTime = performance.now()
      const timeElapsed = Math.round(endTime - startTime)

      setPrediction(result.toString())
      setInferenceTime(timeElapsed)
      setIsLoading(false)
    } catch (err) {
      console.error(err)
      alert("Contract call failed. Check console.")
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>On-Chain Handwritten Digit Recognition Test</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4">Write a digit (0-9) on the canvas below, then click "Predict" to run inference</p>
          <CanvasBoard ref={canvasRef} />
          <div className="mt-4 flex justify-between">
            <Button onClick={handleClear} variant="outline">
              Clear
            </Button>
            <Button onClick={handlePredict}>Predict</Button>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start">
          <div className="flex items-center">
            <strong>Prediction Result:</strong>
            <span className="ml-2">{prediction}</span>
            {isLoading && (
              <div className="ml-2 animate-spin">
                <Image src={monadLogo || "/placeholder.svg"} alt="Loading..." width={20} height={20} />
              </div>
            )}
          </div>
          {inferenceTime !== null && <div>Inference Time (Monad Devnet): {inferenceTime}ms</div>}
        </CardFooter>
      </Card>
    </div>
  )
}

function downsampleTo16x16(imgData: ImageData) {
  const { width, height, data } = imgData
  const out = new Array(16 * 16).fill(0)
  const blockW = width / 16
  const blockH = height / 16

  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      let sum = 0
      let count = 0
      const rStart = Math.floor(row * blockH)
      const rEnd = Math.floor((row + 1) * blockH)
      const cStart = Math.floor(col * blockW)
      const cEnd = Math.floor((col + 1) * blockW)

      for (let rr = rStart; rr < rEnd; rr++) {
        for (let cc = cStart; cc < cEnd; cc++) {
          const idx = (rr * width + cc) * 4
          const r = data[idx],
            g = data[idx + 1],
            b = data[idx + 2],
            a = data[idx + 3]
          if (a > 0) {
            const gray = 255 - (r + g + b) / 3
            sum += gray
            count++
          }
        }
      }
      let avg = 0
      if (count > 0) {
        avg = sum / count
      }
      out[row * 16 + col] = avg
    }
  }
  return out
}

