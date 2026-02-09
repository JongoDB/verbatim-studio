import { useEffect, useRef, useState } from 'react';

interface AudioLevelMeterProps {
  stream: MediaStream | null;
  isActive: boolean;
}

export function AudioLevelMeter({ stream, isActive }: AudioLevelMeterProps) {
  const [level, setLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || !isActive) {
      setLevel(0);
      return;
    }

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      // Average of all frequency bins, normalized to 0-1
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length / 255;
      setLevel(avg);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      source.disconnect();
      audioCtx.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [stream, isActive]);

  // Color gradient: green < 0.5, yellow < 0.8, red >= 0.8
  const color =
    level < 0.5
      ? 'bg-green-500'
      : level < 0.8
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const widthPercent = Math.min(level * 100, 100);

  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-75 ${color}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}
