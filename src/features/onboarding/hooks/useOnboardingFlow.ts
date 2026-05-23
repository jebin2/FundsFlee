"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export const STEPS = ["welcome", "sheet", "profile", "shortcut", "done"] as const;
export type OnboardingStep = typeof STEPS[number];

export interface OnboardingFlow {
  step: OnboardingStep;
  stepIndex: number;
  sheetUrl: string;
  sheetId: string;
  loading: boolean;
  region: string;
  setRegion: (r: string) => void;
  tags: string[];
  token: string;
  initSheet: () => Promise<void>;
  toggleTag: (tag: string) => void;
  saveProfileAndContinue: () => Promise<void>;
  goToStep: (step: OnboardingStep) => void;
  finish: () => void;
}

export function useOnboardingFlow(): OnboardingFlow {
  const { data: session } = useSession();
  const router = useRouter();
  const [step,     setStep]     = useState<OnboardingStep>("welcome");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetId,  setSheetId]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [region,   setRegion]   = useState("");
  const [tags,     setTags]     = useState<string[]>([]);
  const [token,    setToken]    = useState("");

  useEffect(() => {
    if (step === "shortcut") void loadToken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function loadToken() {
    const sid = sheetId || localStorage.getItem("sheetId") || "";
    const res = await fetch(`/api/user/token?sheetId=${sid}`);
    const data = await res.json();
    setToken(data.token);
  }

  async function initSheet() {
    setLoading(true);
    try {
      const res = await fetch("/api/sheet/init", { method: "POST" });
      const data = await res.json();
      const resolvedUrl = (data.sheetUrl && data.sheetUrl.startsWith("https://"))
        ? data.sheetUrl
        : `https://docs.google.com/spreadsheets/d/${data.sheetId}/edit`;
      setSheetId(data.sheetId);
      setSheetUrl(resolvedUrl);
      localStorage.setItem("sheetId", data.sheetId);
      localStorage.setItem("sheetUrl", resolvedUrl);
      setStep("sheet");
    } catch {
      alert("Failed to create sheet. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfileAndContinue() {
    if (region) localStorage.setItem("region", region);
    if (tags.length) localStorage.setItem("lifestyle_tags", JSON.stringify(tags));
    const sid = sheetId || localStorage.getItem("sheetId") || "";
    if (sid) {
      await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sid, name: session?.user?.name ?? "", region, lifestyle_tags: JSON.stringify(tags) }),
      });
    }
    setStep("shortcut");
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  return {
    step, stepIndex: STEPS.indexOf(step),
    sheetUrl, sheetId, loading,
    region, setRegion, tags, token,
    initSheet, toggleTag, saveProfileAndContinue,
    goToStep: setStep,
    finish: () => router.replace("/dashboard"),
  };
}
