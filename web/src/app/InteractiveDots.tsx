'use client';

import { useCallback, useEffect, useRef } from 'react';

type Dot = {
  x: number;
  y: number;
  originalX: number;
  originalY: number;
  phase: number;
};

type Ripple = {
  x: number;
  y: number;
  time: number;
  intensity: number;
};

type InteractiveDotsProps = {
  backgroundColor?: string;
  dotColor?: string;
  gridSpacing?: number;
  animationSpeed?: number;
  removeWaveLine?: boolean;
};

export function InteractiveDots({
  backgroundColor = '#f5f5f5',
  dotColor = '#d4d4d4',
  gridSpacing = 32,
  animationSpeed = 0.008,
  removeWaveLine = true,
}: InteractiveDotsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const ripples = useRef<Ripple[]>([]);
  const dotsRef = useRef<Dot[]>([]);

  const getMouseInfluence = (x: number, y: number) => {
    const dx = x - mouseRef.current.x;
    const dy = y - mouseRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = 150;
    return Math.max(0, 1 - distance / maxDistance);
  };

  const getRippleInfluence = (x: number, y: number, currentTime: number) => {
    let totalInfluence = 0;

    ripples.current.forEach((ripple) => {
      const age = currentTime - ripple.time;
      const maxAge = 3000;

      if (age < maxAge) {
        const dx = x - ripple.x;
        const dy = y - ripple.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const rippleRadius = (age / maxAge) * 300;
        const rippleWidth = 60;

        if (Math.abs(distance - rippleRadius) < rippleWidth) {
          const rippleStrength = (1 - age / maxAge) * ripple.intensity;
          const proximityToRipple = 1 - Math.abs(distance - rippleRadius) / rippleWidth;
          totalInfluence += rippleStrength * proximityToRipple;
        }
      }
    });

    return Math.min(totalInfluence, 2);
  };

  const initializeDots = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dots: Dot[] = [];
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    for (let x = gridSpacing / 2; x < canvasWidth; x += gridSpacing) {
      for (let y = gridSpacing / 2; y < canvasHeight; y += gridSpacing) {
        dots.push({
          x,
          y,
          originalX: x,
          originalY: y,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    dotsRef.current = dots;
  }, [gridSpacing]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    initializeDots();
  }, [initializeDots]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    mouseRef.current.x = event.clientX - rect.left;
    mouseRef.current.y = event.clientY - rect.top;
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const now = Date.now();

    ripples.current.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      time: now,
      intensity: 2,
    });

    ripples.current = ripples.current.filter((ripple) => now - ripple.time < 3000);
  }, []);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    timeRef.current += animationSpeed;
    const currentTime = Date.now();
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const red = Number.parseInt(dotColor.slice(1, 3), 16);
    const green = Number.parseInt(dotColor.slice(3, 5), 16);
    const blue = Number.parseInt(dotColor.slice(5, 7), 16);

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    dotsRef.current.forEach((dot) => {
      const totalInfluence =
        getMouseInfluence(dot.originalX, dot.originalY) +
        getRippleInfluence(dot.originalX, dot.originalY, currentTime);
      const dotSize = 1.35 + totalInfluence * 4.2 + Math.sin(timeRef.current + dot.phase) * 0.45;
      const opacity = Math.max(
        0.2,
        0.34 + totalInfluence * 0.42 + Math.abs(Math.sin(timeRef.current * 0.5 + dot.phase)) * 0.08,
      );

      ctx.beginPath();
      ctx.arc(dot.originalX, dot.originalY, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${opacity})`;
      ctx.fill();
    });

    if (!removeWaveLine) {
      ripples.current.forEach((ripple) => {
        const age = currentTime - ripple.time;
        const maxAge = 3000;

        if (age < maxAge) {
          const progress = age / maxAge;
          const alpha = (1 - progress) * 0.3 * ripple.intensity;

          ctx.beginPath();
          ctx.strokeStyle = `rgba(100, 100, 100, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.arc(ripple.x, ripple.y, progress * 300, 0, 2 * Math.PI);
          ctx.stroke();
        }
      });
    }

    animationFrameId.current = requestAnimationFrame(animate);
  }, [animationSpeed, backgroundColor, dotColor, removeWaveLine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);

      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [animate, handleMouseDown, handleMouseMove, resizeCanvas]);

  return (
    <div className="interactive-dots" style={{ backgroundColor }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
