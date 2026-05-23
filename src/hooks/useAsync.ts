"use client";

import { useState, useCallback } from "react";

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  execute: () => Promise<void>;
  reset: () => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  initialData: T
): AsyncState<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [fn]);

  const reset = useCallback(() => setData(initialData), [initialData]);

  return { data, loading, error, execute, reset };
}
