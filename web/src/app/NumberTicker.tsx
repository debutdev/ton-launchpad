'use client';

import { useEffect, useRef, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { useInView, useMotionValue, useSpring } from 'framer-motion';

type NumberTickerProps = ComponentPropsWithoutRef<'span'> & {
  value: number;
  startValue?: number;
  direction?: 'up' | 'down';
  delay?: number;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
};

function formatValue(value: number, decimalPlaces: number, prefix = '', suffix = '') {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(value.toFixed(decimalPlaces)));

  return `${prefix}${formatted}${suffix}`;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
  prefix = '',
  suffix = '',
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === 'down' ? value : startValue);
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  });
  const isInView = useInView(ref as RefObject<Element>, { once: true, margin: '0px' });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isInView) {
      timer = setTimeout(() => {
        motionValue.set(direction === 'down' ? startValue : value);
      }, delay * 1000);
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [delay, direction, isInView, motionValue, startValue, value]);

  useEffect(
    () =>
      springValue.on('change', (latest) => {
        if (ref.current) {
          ref.current.textContent = formatValue(latest, decimalPlaces, prefix, suffix);
        }
      }),
    [decimalPlaces, prefix, springValue, suffix],
  );

  return (
    <span ref={ref} className={className} {...props}>
      {formatValue(direction === 'down' ? value : startValue, decimalPlaces, prefix, suffix)}
    </span>
  );
}
