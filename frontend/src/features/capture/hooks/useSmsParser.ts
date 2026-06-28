"use client";

import { useState, useCallback } from "react";
import type { ParsedTransaction } from "@/types";
import { useAsync } from "@/hooks/useAsync";
import { parseApi } from "@/lib/api/parse";

export function useSmsParser(region: string, initialText = "") {
  const [text, setText] = useState(initialText);

  const parseFn = useCallback(async () => {
    if (!text.trim()) return null;
    const res = await parseApi.text(text, region);
    if (!res.ok) throw new Error("Failed to parse. Try again.");
    const data = await res.json();
    return data.extracted as ParsedTransaction;
  }, [text, region]);

  const { data: parsed, loading: parsing, error: parseError, execute: parseText, reset: resetParsed } =
    useAsync<ParsedTransaction | null>(parseFn, null);

  return { text, setText, parsing, parsed, parseError, resetParsed, parseText };
}
