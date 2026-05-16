import { useEffect, useRef } from "react";
import type { AsyncStatus } from "@/components/analysis/AnalysisStates";

export function usePoller(
  checkFn: () => Promise<AsyncStatus>,
  active: boolean
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep a stable ref so the interval always calls the current checkFn
  // even if it changes between renders (e.g. merchant selection changes).
  const checkFnRef = useRef(checkFn);
  checkFnRef.current = checkFn;

  const stop = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!active) { stop(); return; }
    intervalRef.current = setInterval(async () => {
      const s = await checkFnRef.current();
      if (s !== "generating") stop();
    }, 5000);
    return stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return stop;
}
