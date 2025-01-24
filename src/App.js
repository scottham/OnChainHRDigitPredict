// src/App.js

import React, { useRef, useState } from 'react';
import { ethers } from 'ethers';
import CanvasBoard from './CanvasBoard';
import { CONTRACT_ADDRESS, CONTRACT_ABI, RPC_URL } from './contractConfig';
import './styles.css';
import monadLogo from './assets/Monad Logo - Default - Logo Mark 1.png';

function App() {
  const canvasRef = useRef(null);
  const [prediction, setPrediction] = useState(null);
  const [inferenceTime, setInferenceTime] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clearCanvas();
    }
    setPrediction(null);
    setInferenceTime(null);
  };

  const handlePredict = async () => {
    console.log(RPC_URL)

    const imgData = canvasRef.current.getCanvasData();

    const downsampled = downsampleTo16x16(imgData);

    const input256 = downsampled.map(v => Math.round(v));
    console.log(input256);
    try {
      setIsLoading(true);
      setPrediction(null);
      setInferenceTime(null);
      
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      

      const startTime = performance.now();
      const result = await contract.predictDigit(1, input256);
      const endTime = performance.now();
      const timeElapsed = Math.round(endTime - startTime);
      
      setPrediction(result.toString());
      setInferenceTime(timeElapsed);
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      alert("Contract call failed. Check console.");
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>On-Chain Handwritten Digit Recognition Test</h1>
      <p>Write a digit (0-9) on the canvas below, then click "Predict" to run inference</p>

      <CanvasBoard ref={canvasRef} />

      <div className="controls">
        <button onClick={handleClear}>Clear</button>
        <button onClick={handlePredict} style={{ marginLeft: '10px' }}>Predict</button>
      </div>

      <div className="result">
        <div>
          <strong>Prediction Result:</strong> {prediction}
          {isLoading && <img src={monadLogo} alt="Loading..." className="spinner" style={{width: '20px', height: '20px', marginLeft: '10px'}} />}
        </div>
        {inferenceTime !== null && <div>Inference Time (Monad Devnet): {inferenceTime}ms</div>}
      </div>
    </div>
  );
}

const styles = {
  '.spinner': {
    width: '20px',
    height: '20px',
    marginLeft: '10px',
    animation: 'spin 1s linear infinite',
  },
  '@keyframes spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
};

function downsampleTo16x16(imgData) {
  const { width, height, data } = imgData; // data = [r,g,b,a, r,g,b,a, ...]
  const out = new Array(16 * 16).fill(0);
  const blockW = width / 16;
  const blockH = height / 16;

  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      let sum = 0;
      let count = 0;
      const rStart = Math.floor(row * blockH);
      const rEnd   = Math.floor((row+1) * blockH);
      const cStart = Math.floor(col * blockW);
      const cEnd   = Math.floor((col+1) * blockW);

      for (let rr = rStart; rr < rEnd; rr++) {
        for (let cc = cStart; cc < cEnd; cc++) {
          const idx = (rr * width + cc) * 4;
          const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
          // Only consider pixels that are not fully transparent
          if (a > 0) {
            // Convert to grayscale and invert (since we want black to be 1 and white to be 0)
            const gray = 255 - ((r + g + b) / (3));
            sum += gray;
            count++;
          }
        }
      }
      let avg = 0;
      if (count > 0) {
        avg = sum / count;
      }
      out[row*16 + col] = avg;
    }
  }
  return out;
}

export default App;
