import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';

const CanvasBoard = forwardRef((props, ref) => {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');

    // Set white background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);


    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
  }, []);

  const handleMouseDown = (e) => {
    setDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const handleMouseUp = () => {
    setDrawing(false);
  };


  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };


  useImperativeHandle(ref, () => ({
    clearCanvas,
    getCanvasData: () => {
      const canvas = canvasRef.current;
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    }
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{ border: '2px solid #000' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
});

export default CanvasBoard;
