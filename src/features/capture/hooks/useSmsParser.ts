"use client";

import { useState, useCallback } from "react";
import type { ParsedTransaction } from "@/types";

export function useSmsParser(region: string) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedTransaction | null>(null);

  const parseText = useCallback(async () => {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/parse/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, region }),
      });
      const data = await res.json();
      setParsed(data.extracted);
    } catch {
      alert("Failed to parse. Try again.");
    } finally {
      setParsing(false);
    }
  }, [text, region]);

  return { text, setText, parsing, parsed, resetParsed: () => setParsed(null), parseText };
}
