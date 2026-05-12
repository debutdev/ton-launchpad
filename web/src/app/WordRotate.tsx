'use client';

import { useEffect, useState } from 'react';

type WordRotateProps = {
  words: string[];
  duration?: number;
  className?: string;
};

export function WordRotate({ words, duration = 2500, className }: WordRotateProps) {
  const [index, setIndex] = useState(0);
  const previousIndex = (index - 1 + words.length) % words.length;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % words.length);
    }, duration);

    return () => window.clearInterval(interval);
  }, [duration, words.length]);

  return (
    <span className="word-rotate" aria-live="polite">
      <span aria-hidden="true" className={`word-rotate-measure ${className ?? ''}`}>
        {words[index]}
      </span>
      <span aria-hidden="true" className={`word-rotate-item word-rotate-exit ${className ?? ''}`} key={`old-${words[previousIndex]}-${index}`}>
        {words[previousIndex]}
      </span>
      <span className={`word-rotate-item word-rotate-enter ${className ?? ''}`} key={`new-${words[index]}`}>
        {words[index]}
      </span>
    </span>
  );
}
