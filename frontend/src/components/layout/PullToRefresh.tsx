"use client";

import { useRef, useState, useEffect } from "react";

const THRESHOLD = 72; // px pull needed to trigger refresh

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);      // 0–1+ progress ratio
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);
  const isPullingRef = useRef(false);

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startY = 0;
    let currentPull = 0;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || refreshingRef.current) return;
      startY = e.touches[0].clientY;
      currentPull = 0;
      isPullingRef.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!isPullingRef.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { isPullingRef.current = false; return; }
      e.preventDefault();
      // Dampen pull so it feels elastic
      currentPull = Math.min(dy / THRESHOLD, 1.3);
      setPull(currentPull);
    }

    function onTouchEnd() {
      if (!isPullingRef.current) return;
      isPullingRef.current = false;

      if (currentPull >= 1 && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(0);
        onRefreshRef.current().finally(() => {
          setRefreshing(false);
          refreshingRef.current = false;
        });
      } else {
        setPull(0);
      }
      currentPull = 0;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const indicatorH = refreshing ? THRESHOLD : Math.round(pull * THRESHOLD);
  const active = pull > 0 || refreshing;
  const ready = pull >= 1;

  return (
    <div ref={containerRef}>
      {/* Indicator strip */}
      <div
        style={{
          height: indicatorH,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // eslint-disable-next-line react-hooks/refs
          transition: isPullingRef.current ? "none" : "height 0.3s ease",
        }}
      >
        {active && (
          <span
            className={`material-symbols-outlined${refreshing ? " animate-spin" : ""}`}
            style={{
              fontSize: 22,
              color: ready || refreshing ? "var(--color-primary)" : "var(--color-outline)",
              transform: refreshing ? "none" : `rotate(${pull * 360}deg)`,
              transition: refreshing ? "none" : "color 0.2s",
            }}
          >
            {refreshing ? "progress_activity" : "refresh"}
          </span>
        )}
      </div>

      {children}
    </div>
  );
}
