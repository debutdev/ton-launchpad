'use client';

import { type CSSProperties } from 'react';

type GradientBarsProps = {
  className?: string;
  numBars?: number;
  colors?: string[];
  orientation?: 'vertical' | 'horizontal';
  animation?: 'wave' | 'pulse' | 'none';
  duration?: number;
  delayStep?: number;
  minScale?: number;
  maxScale?: number;
};

export function GradientBars({
  className,
  numBars = 15,
  colors = ['#000fff', 'transparent'],
  orientation = 'vertical',
  animation = 'wave',
  duration = 2,
  delayStep = 0.1,
  minScale = 0.2,
  maxScale = 1,
}: GradientBarsProps) {
  const gradient = `linear-gradient(${orientation === 'vertical' ? '0deg' : '90deg'}, ${colors.join(', ')})`;

  return (
    <div
      aria-hidden="true"
      className={`gradient-bars gradient-bars-${orientation} gradient-bars-${animation}${className ? ` ${className}` : ''}`}
      style={{
        '--gradient-bars-count': numBars,
        '--gradient-bars-duration': `${duration}s`,
        '--gradient-bars-min-scale': minScale,
        '--gradient-bars-max-scale': maxScale,
      } as CSSProperties}
    >
      {Array.from({ length: numBars }, (_, index) => (
        <span
          key={index}
          style={{
            '--gradient-bar-background': gradient,
            '--gradient-bar-delay': `${index * delayStep}s`,
            '--gradient-bar-index': index,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
