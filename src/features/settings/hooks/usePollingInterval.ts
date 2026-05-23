import { useRef, useEffect, useCallback } from "react";

type TickCallback = (tick: number, stop: () => void) => void;

export function usePollingInterval() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(0);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    tickRef.current = 0;
  }, []);

  const start = useCallback((
    callback: TickCallback,
    intervalMs: number,
    maxTicks = Infinity,
    onExpiry?: () => void
  ) => {
    stop();
    intervalRef.current = setInterval(() => {
      const tick = ++tickRef.current;
      if (tick > maxTicks) { stop(); onExpiry?.(); return; }
      callback(tick, stop);
    }, intervalMs);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { start, stop };
}
