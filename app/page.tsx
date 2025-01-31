"use client"

import { useRef, useState } from "react"
import { ethers } from "ethers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import CanvasBoard from "@/components/CanvasBoard"
import { CONTRACT_ADDRESS, CONTRACT_ABI, RPC_URL } from "@/lib/contractConfig"
import Image from "next/image"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"

export default function Page() {
  const canvasRef = useRef<any>(null)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [inferenceTime, setInferenceTime] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [nftId, setNftId] = useState("1")

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
    // Convert to grayscale and normalize to 0-255 range
    const grayscaleData = []
    for (let i = 0; i < imgData.data.length; i += 4) {
      // Convert RGBA to grayscale using standard weights
      const gray = Math.round(
        imgData.data[i] * 0.299 +     // Red
        imgData.data[i + 1] * 0.587 + // Green
        imgData.data[i + 2] * 0.114   // Blue
      )
      grayscaleData.push(gray)
    }
    // Reshape into 28x28 2D array
    const matrix28x28 = []
    for (let i = 0; i < 28; i++) {
      const row = []
      for (let j = 0; j < 28; j++) {
        row.push(grayscaleData[i * 28 + j])
      }
      matrix28x28.push(row)
    }
    // matrix28x28 is now a 28x28 2D array of grayscale values (0-255)
    const input28x28 = matrix28x28
    console.log(input28x28)
    try {
      setIsLoading(true)
      setPrediction(null)
      setInferenceTime(null)

      const provider = new ethers.providers.JsonRpcProvider(RPC_URL)

      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider)

      const startTime = performance.now()
      const result = await contract.inference(Number(nftId), input28x28)
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
          <div className="mb-4">
            <label htmlFor="nftId" className="block text-sm font-medium mb-2">NFT ID for Inference:</label>
            <Input
              id="nftId"
              type="number"
              min="1"
              value={nftId}
              onChange={(e) => setNftId(e.target.value)}
              className="w-full"
            />
          </div>
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