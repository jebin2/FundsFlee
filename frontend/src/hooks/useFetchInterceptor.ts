"use client";

import { useEffect, useRef } from "react";

// Module-level guard — prevents double-wrapping fetch in React StrictMode dev
let fetchIntercepted = false;

export function useFetchInterceptor(onUnauthorized: () => void) {
  // Keep a stable ref so the closure always calls the current callback,
  // even though the effect runs only once (fetchIntercepted guard).
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { onUnauthorizedRef.current = onUnauthorized; });

  useEffect(() => {
    if (fetchIntercepted) return;
    fetchIntercepted = true;

    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      const input = args[0];
      const url =
        typeof input === "string" ? input :
        input instanceof Request ? input.url :
        input instanceof URL ? input.pathname :
        "";
      if (res.status === 401 && url.includes("/api/")) {
        onUnauthorizedRef.current();
      }
      return res;
    };

    return () => {
      window.fetch = original;
      fetchIntercepted = false;
    };
  }, []);
}
