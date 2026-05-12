'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

type DitheredSwirlProps = {
  width?: number;
  height?: number;
  fg?: string;
  bg?: string;
  ac?: string;
  pixelSize?: number;
  threshold?: number;
  spread?: number;
  acMix?: number;
  acMode?: 'blend' | 'hard' | 'pattern';
  fps?: number;
  speed?: number;
  twist?: number;
  scale?: number;
  pattern?: 'swirl' | 'waves' | 'plasma' | 'noise';
  cursorMode?: 'none' | 'ripple';
  cursorSize?: number;
  cursorScale?: number;
  className?: string;
  style?: CSSProperties;
};

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((value) => (value + 0.5) / 16);

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(full, 16);

  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
}

function shouldPaintBackground(bg: string) {
  return bg !== 'transparent' && bg !== 'none' && bg.trim() !== '';
}

function hashNoise(x: number, y: number, time: number) {
  return Math.sin(x * 12.9898 + y * 78.233 + time * 0.48) * 43758.5453 % 1;
}

export function DitheredSwirl({
  width: _width = 1000,
  height: _height = 1000,
  fg = '#ff0000',
  bg = 'transparent',
  ac = '#00ff00',
  pixelSize = 2,
  threshold = 0.51,
  spread = 0.5,
  acMix = 0,
  acMode = 'blend',
  fps = 24,
  speed = 1,
  twist = 0,
  scale = 10,
  pattern = 'swirl',
  cursorMode = 'none',
  cursorSize = 0.3,
  cursorScale = 0.2,
  className,
  style,
}: DitheredSwirlProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const cursorRef = useRef({ active: false, x: 0, y: 0, lastMovedAt: 0 });

  useEffect(() => {
    const currentCanvas = canvasRef.current;
    if (!currentCanvas) return undefined;
    const canvasElement: HTMLCanvasElement = currentCanvas;
    const currentContext = canvasElement.getContext('2d', { alpha: true });
    if (!currentContext) return undefined;
    const context: CanvasRenderingContext2D = currentContext;

    const fgRgb = hexToRgb(fg);
    const acRgb = hexToRgb(ac);
    const bgRgb = shouldPaintBackground(bg) ? hexToRgb(bg) : null;
    const effectivePixelSize = Math.max(4, pixelSize * 4);
    const targetFrameMs = 1000 / Math.max(1, fps);
    let lastDrawTime = 0;

    function updateCursor(event: PointerEvent) {
      const rect = canvasElement.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        cursorRef.current.active = false;
        return;
      }

      cursorRef.current = {
        active: true,
        x: (event.clientX - rect.left) / Math.max(rect.width, 1),
        y: (event.clientY - rect.top) / Math.max(rect.height, 1),
        lastMovedAt: performance.now(),
      };
    }

    function clearCursor() {
      cursorRef.current.active = false;
    }

    function resize() {
      const rect = canvasElement.getBoundingClientRect();
      const lowWidth = Math.max(1, Math.floor(rect.width / effectivePixelSize));
      const lowHeight = Math.max(1, Math.floor(rect.height / effectivePixelSize));

      if (canvasElement.width !== lowWidth || canvasElement.height !== lowHeight) {
        canvasElement.width = lowWidth;
        canvasElement.height = lowHeight;
      }
    }

    function render(timeMs: number) {
      frameRef.current = requestAnimationFrame(render);
      if (document.hidden || timeMs - lastDrawTime < targetFrameMs) return;
      lastDrawTime = timeMs;

      resize();

      const time = (timeMs / 1000) * speed;
      const canvasWidth = canvasElement.width;
      const canvasHeight = canvasElement.height;
      const imageData = context.createImageData(canvasWidth, canvasHeight);
      const data = imageData.data;
      const aspect = canvasWidth / Math.max(canvasHeight, 1);

      for (let y = 0; y < canvasHeight; y += 1) {
        for (let x = 0; x < canvasWidth; x += 1) {
          const index = (y * canvasWidth + x) * 4;

          if (bgRgb) {
            data[index] = bgRgb[0];
            data[index + 1] = bgRgb[1];
            data[index + 2] = bgRgb[2];
            data[index + 3] = 255;
          }

          const uvX = (x / Math.max(canvasWidth - 1, 1) - 0.5) * aspect;
          const uvY = y / Math.max(canvasHeight - 1, 1) - 0.5;
          const radius = Math.sqrt(uvX * uvX + uvY * uvY);
          let value: number;

          if (pattern === 'noise') {
            const scaledX = uvX * (20 + scale * 3);
            const scaledY = uvY * (20 + scale * 3);
            const grainA = hashNoise(Math.floor(scaledX), Math.floor(scaledY), time);
            const grainB = hashNoise(Math.floor(scaledX * 0.54 + 19), Math.floor(scaledY * 0.54 - 11), time * 0.7);
            const grainC = Math.sin((uvX + grainB) * 13 + time * 0.8) * Math.cos((uvY - grainA) * 11 - time * 0.55);
            const vignette = Math.max(0, 1 - radius * 1.18);
            value = 0.38 + 0.3 * grainA + 0.18 * grainB + 0.16 * grainC + 0.12 * vignette;
          } else if (pattern === 'plasma') {
            const driftX = Math.sin(time * 0.42) * 0.18;
            const driftY = Math.cos(time * 0.34) * 0.16;
            const blobA = Math.sin((uvX + driftX) * (8 + scale) + Math.sin((uvY - driftY) * 6));
            const blobB = Math.cos((uvY - driftY) * (9 + scale * 0.7) + Math.cos((uvX + driftX) * 5));
            const blobC = Math.sin((uvX * uvX + uvY * uvY) * (32 + scale * 4) - time * 1.4);
            const sweep = Math.sin((uvX - uvY) * 7 + time * 0.8);
            const vignette = Math.max(0, 1 - radius * 1.22);
            value = 0.43 + 0.21 * blobA + 0.18 * blobB + 0.13 * blobC + 0.1 * sweep + 0.13 * vignette;
          } else if (pattern === 'waves') {
            const horizontalWave = Math.sin((uvY * (12 + scale * 0.8)) + time * 1.2);
            const diagonalWave = Math.sin(((uvX + uvY) * (10 + scale)) - time * 0.9);
            const softGrid = Math.cos((uvX * 16) + time * 0.65) * Math.cos((uvY * 10) - time * 0.45);
            const vignette = Math.max(0, 1 - radius * 1.32);
            value = 0.44 + 0.22 * horizontalWave + 0.18 * diagonalWave + 0.12 * softGrid + 0.12 * vignette;
          } else {
            const angle = Math.atan2(uvY, uvX);
            const swirl = Math.sin((angle + radius * (9 + twist * 10)) * scale + time * 1.8);
            const rings = Math.cos(radius * (30 * spread + 3) - time * 2.4);
            const wave = Math.sin((uvX - uvY) * (7 + scale) + time);
            value = 0.5 + 0.26 * swirl + 0.18 * rings + 0.12 * wave;
          }

          if (cursorMode === 'ripple' && cursorRef.current.active) {
            const cursorUvX = (cursorRef.current.x - 0.5) * aspect;
            const cursorUvY = cursorRef.current.y - 0.5;
            const dx = uvX - cursorUvX;
            const dy = uvY - cursorUvY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const fadeMs = Math.min(1, Math.max(0, 1 - (timeMs - cursorRef.current.lastMovedAt) / 1400));
            const falloff = Math.max(0, 1 - distance / Math.max(0.01, cursorSize));
            const ripple = Math.cos(distance * 46 - time * 7) * falloff * falloff * cursorScale * fadeMs;
            value += ripple;
          }

          const dither = BAYER_4[(x % 4) + (y % 4) * 4] - 0.5;
          const painted = value + dither * spread > threshold;

          if (painted) {
            let red = fgRgb[0];
            let green = fgRgb[1];
            let blue = fgRgb[2];

            if (acMix > 0) {
              const accentPattern = acMode === 'pattern' ? Number((x + y + Math.floor(time * 10)) % 3 === 0) : value;
              const mix = acMode === 'hard' ? Number(accentPattern > 0.55) * acMix : Math.min(1, acMix * accentPattern);
              red = Math.round(red * (1 - mix) + acRgb[0] * mix);
              green = Math.round(green * (1 - mix) + acRgb[1] * mix);
              blue = Math.round(blue * (1 - mix) + acRgb[2] * mix);
            }

            data[index] = red;
            data[index + 1] = green;
            data[index + 2] = blue;
            data[index + 3] = 180;
          }
        }
      }

      context.putImageData(imageData, 0, 0);
    }

    context.imageSmoothingEnabled = false;
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', updateCursor);
    window.addEventListener('pointerleave', clearCursor);
    frameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', updateCursor);
      window.removeEventListener('pointerleave', clearCursor);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [ac, acMix, acMode, bg, cursorMode, cursorScale, cursorSize, fg, fps, pattern, pixelSize, scale, speed, spread, threshold, twist]);

  return (
    <canvas
      aria-hidden="true"
      className={`dithered-swirl ${className ?? ''}`}
      ref={canvasRef}
      style={style}
    />
  );
}
