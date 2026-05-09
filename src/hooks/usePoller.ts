import { useEffect, useRef } from "react";
import type { AsyncStatus } from "@/components/analysis/AnalysisStates";

export function usePoller(
  checkFn: () => Promise<AsyncStatus>,
  active: boolean
) {
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (ref.current) { clearInterval(ref.current); ref.current = null; } };

  useEffect(() => {
    if (!active) { stop(); return; }
    ref.current = setInterval(async () => {
      const s = await checkFn();
      if (s !== "generating") stop();
    }, 5000);
    return stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return stop;
}
