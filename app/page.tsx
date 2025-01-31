"use client"

import { useRef, useState } from "react"
import { ethers } from "ethers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import CanvasBoard from "@/components/CanvasBoard"
import { CONTRACT_ADDRESS, CONTRACT_ABI, RPC_URL } from "@/lib/contractConfig"
import Image from "next/image"
import monadLogo from "@/public/Monad Logo - Default - Logo Mark 1.png"
import { toast } from "@/components/ui/use-toast"

export default function Page() {
  const canvasRef = useRef<any>(null)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [inferenceTime, setInferenceTime] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [nftId, setNftId] = useState("1")
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null)
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false)
  const [isMinting, setIsMinting] = useState(false)
  const [newNftId, setNewNftId] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<any>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const formatFileName = (name: string) => {
    if (name.length <= 20) return name
    return "..." + name.slice(-20)
  }

  // Function to check if connected to correct network
  const checkNetwork = async (web3Provider: ethers.providers.Web3Provider) => {
    try {
      const network = await web3Provider.getNetwork()
      const targetNetwork = await new ethers.providers.JsonRpcProvider(RPC_URL).getNetwork()
      return network.chainId === targetNetwork.chainId
    } catch (err) {
      console.error("Error checking network:", err)
      return false
    }
  }

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
        imgData.data[i] * 0.299 + // Red
          imgData.data[i + 1] * 0.587 + // Green
          imgData.data[i + 2] * 0.114, // Blue
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

      // Use connected wallet if available, otherwise fallback to RPC
      const contractProvider = provider || new ethers.providers.JsonRpcProvider(RPC_URL)

      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, contractProvider)

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
      <Card className="w-full max-w-2xl p-2">
        <CardHeader className="flex flex-row items-center justify-between px-6 py-4">
          <CardTitle>On-Chain Handwritten Digit Recognition Test</CardTitle>
          <Button
            onClick={async () => {
              try {
                if (!window.ethereum) {
                  alert("Please install MetaMask!")
                  return
                }
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum)
                await window.ethereum.request({ method: "eth_requestAccounts" })

                // Check if on correct network
                const correctNetwork = await checkNetwork(web3Provider)
                if (!correctNetwork) {
                  const targetNetwork = await new ethers.providers.JsonRpcProvider(RPC_URL).getNetwork()
                  alert(
                    `Please switch to ${targetNetwork.name || "the correct network"} (Chain ID: ${targetNetwork.chainId}) in your wallet`,
                  )
                  setIsCorrectNetwork(false)
                  const signer = web3Provider.getSigner()
                  const address = await signer.getAddress()
                  setProvider(web3Provider)
                  setAccount(address)
                  return
                }

                setIsCorrectNetwork(true)
                const signer = web3Provider.getSigner()
                const address = await signer.getAddress()
                setProvider(web3Provider)
                setAccount(address)
              } catch (err) {
                console.error(err)
                alert("Failed to connect wallet")
              }
            }}
            variant="outline"
            size="sm"
            className={!isCorrectNetwork && account ? "bg-red-100 hover:bg-red-200" : ""}
          >
            {account
              ? isCorrectNetwork
                ? `${account.slice(0, 6)}...${account.slice(-4)}`
                : "Wrong Network"
              : "Connect Wallet"}
          </Button>
        </CardHeader>
        <CardContent className="px-6 py-4">
          <p className="mb-4">Write a digit (0-9) on the canvas below, then click "Predict" to run inference</p>
          <div className="mb-4">
            <label htmlFor="nftId" className="block text-sm font-medium mb-2">
              NFT ID for Inference:
            </label>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="w-full sm:w-[30%]">
                <Input
                  id="nftId"
                  type="number"
                  min="1"
                  value={nftId}
                  onChange={(e) => setNftId(e.target.value)}
                  className="w-full h-11"
                />
              </div>
              <div className="flex flex-1 justify-between gap-4">
                <div className="flex-1">
                  <Input
                    type="file"
                    accept=".json"
                    id="file-upload"
                    className="hidden"
                    onChange={async (e) => {
                      try {
                        const file = e.target.files?.[0]
                        if (!file) {
                          setFileName(null)
                          setModelParams(null)
                          return
                        }

                        setFileName(file.name)
                        const reader = new FileReader()
                        reader.onload = async (event) => {
                          try {
                            const params = JSON.parse(event.target?.result as string)
                            setModelParams(params)
                            toast({
                              title: "Success",
                              description: "Model parameters loaded successfully. Click 'Mint NFT' to proceed.",
                            })
                          } catch (err: any) {
                            console.error(err)
                            toast({
                              title: "Error",
                              description: "Failed to parse JSON file",
                              variant: "destructive",
                            })
                            setModelParams(null)
                            setFileName(null)
                          }
                        }
                        reader.readAsText(file)
                      } catch (err: any) {
                        console.error(err)
                        toast({
                          title: "Error",
                          description: err.message || "Failed to read file",
                          variant: "destructive",
                        })
                        setModelParams(null)
                        setFileName(null)
                      }
                    }}
                  />
                  <Label
                    htmlFor="file-upload"
                    className="cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 w-full overflow-hidden"
                  >
                    <span className="truncate">{fileName ? formatFileName(fileName) : "Upload your parameters"}</span>
                  </Label>
                </div>
                <Button
                  onClick={async () => {
                    try {
                      if (!account) {
                        toast({
                          title: "Error",
                          description: "Please connect your wallet first",
                          variant: "destructive",
                        })
                        return
                      }

                      if (!isCorrectNetwork) {
                        toast({
                          title: "Error",
                          description: "Please switch to the correct network",
                          variant: "destructive",
                        })
                        return
                      }

                      if (!modelParams) {
                        toast({
                          title: "Error",
                          description: "Please upload a model parameters file first",
                          variant: "destructive",
                        })
                        return
                      }

                      const feeData = await provider!.getFeeData()
                      console.log("Network suggested gas prices:", {
                        maxFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas || 0, "gwei"),
                        maxPriorityFeePerGas: ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, "gwei"),
                      })

                      setIsMinting(true)
                      const signer = provider!.getSigner()
                      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer)

                      const gasEstimate = await contract.estimateGas.mint(
                        modelParams.conv1,
                        modelParams.conv1_bias,
                        modelParams.conv2,
                        modelParams.conv2_bias,
                        modelParams.fc,
                        modelParams.fc_bias,
                        {
                          maxFeePerGas: feeData.maxFeePerGas,
                          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        },
                      )

                      const gasLimit = gasEstimate.mul(120).div(100)
                      console.log(`Estimated gas limit: ${gasEstimate.toString()}, Setting to: ${gasLimit.toString()}`)

                      const tx = await contract.mint(
                        modelParams.conv1,
                        modelParams.conv1_bias,
                        modelParams.conv2,
                        modelParams.conv2_bias,
                        modelParams.fc,
                        modelParams.fc_bias,
                        {
                          maxFeePerGas: feeData.maxFeePerGas,
                          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                          gasLimit: gasLimit,
                        },
                      )

                      const receipt = await tx.wait()
                      const hexId = receipt.logs[0].topics[3]
                      const newId = ethers.BigNumber.from(hexId).toString()
                                            
                      setNewNftId(newId)
                      toast({
                        title: "Success",
                        description: `Successfully minted NFT with ID: ${newId}`,
                      })
                    } catch (err: any) {
                      console.error(err)
                      toast({
                        title: "Error",
                        description: err.message || "Failed to mint NFT",
                        variant: "destructive",
                      })
                    } finally {
                      setIsMinting(false)
                    }
                  }}
                  disabled={!modelParams || isMinting || !account || !isCorrectNetwork}
                  title={
                    !account
                      ? "Please connect your wallet first"
                      : !isCorrectNetwork
                        ? "Please switch to the correct network"
                        : !modelParams
                          ? "Please upload model parameters first"
                          : ""
                  }
                  className="h-11 px-8 whitespace-nowrap flex-1"
                >
                  {isMinting ? "Minting..." : newNftId ? `NFT ID: ${newNftId}` : "Mint NFT"}
                </Button>
              </div>
            </div>
            {(isMinting || newNftId) && (
              <div className="mt-2">
                {isMinting && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="animate-spin">
                      <Image src={monadLogo || "/placeholder.svg"} alt="Minting..." width={16} height={16} />
                    </div>
                    <span>Minting in progress...</span>
                  </div>
                )}
                {newNftId && <div className="text-sm text-green-600">Successfully minted NFT with ID: {newNftId}</div>}
              </div>
            )}
          </div>
          <CanvasBoard ref={canvasRef} />
          <div className="mt-4 flex justify-between">
            <Button onClick={handleClear} variant="outline">
              Clear
            </Button>
            <Button onClick={handlePredict}>Predict</Button>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-4 w-full px-6 py-4">
          <div className="flex flex-col w-full gap-2">
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
          </div>
          <div className="w-full mt-4 pt-4 border-t text-center text-sm text-muted-foreground flex flex-col gap-2">
            <a
              href="https://github.com/scottham/OnChainHRDigitPredict"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors inline-flex items-center gap-1 justify-center"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              View project on GitHub
            </a>
            <div>
              Model parameters can be generated using{" "}
              <a
                href="https://github.com/scottham/OnChainHRDigitPredict/blob/main/model/train.py"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono text-sm"
              >
                model/train.py
              </a>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

