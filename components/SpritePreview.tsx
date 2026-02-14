import React, { useEffect, useRef } from 'react';

interface SpritePreviewProps {
  pixels: string[][];
  label: string;
  scale?: number;
}

const SpritePreview: React.FC<SpritePreviewProps> = ({ pixels, label, scale = 8 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const height = pixels.length;
  const width = pixels[0]?.length || 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw checkered background
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = '#262626'; 
        } else {
          ctx.fillStyle = '#171717'; 
        }
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    // Draw pixels
    pixels.forEach((row, y) => {
      row.forEach((color, x) => {
        if (!color || color === 'transparent' || color === '#00000000') return;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      });
    });
  }, [pixels, scale, width, height]);

  if (!pixels || pixels.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-neutral-500 font-bold">{label}</span>
      <div className="p-1 bg-neutral-800 rounded border border-neutral-700">
        <canvas
          ref={canvasRef}
          width={width * scale}
          height={height * scale}
          className="image-pixelated rounded-sm"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
};

export default SpritePreview;

