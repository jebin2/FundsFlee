"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Step = "upload" | "uploading" | "done" | "error";

export default function ImportPage() {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep]   = useState<Step>("upload");
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    setStep("uploading");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse/statement/async", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Upload failed");
      }
      setStep("done");
      setTimeout(() => router.push("/transactions"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("error");
    }
  }

  if (step === "uploading") return (
    <div className="max-w-lg mx-auto px-5 flex flex-col items-center justify-center gap-6 pt-24">
      <div className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin"
        style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
      <div className="text-center">
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>Uploading statement…</p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", marginTop: 6 }}>
          Uploading to Drive then handing off to AI. You can navigate away.
        </p>
      </div>
    </div>
  );

  if (step === "done") return (
    <div className="max-w-lg mx-auto px-5 flex flex-col items-center justify-center gap-6 pt-24">
      <div className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined animate-spin"
          style={{ fontSize: 32, color: "var(--color-primary)" }}>auto_awesome</span>
      </div>
      <div className="text-center">
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>AI is reading your statement</p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", marginTop: 6 }}>
          Transactions will appear in the list as they&apos;re extracted. Taking you there now…
        </p>
      </div>
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-5 pb-10">
      <div className="md:hidden flex items-center pt-10 pb-4 gap-3">
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Import Bank Statement</h1>
      </div>

      <div className="flex flex-col gap-5 pt-2">
        <div className="rounded-2xl p-4" style={{ background: "var(--color-primary-fixed)" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }} className="mb-2">How it works</p>
          <div className="flex flex-col gap-1.5">
            {[
              "Upload your bank statement PDF",
              "AI extracts all debit transactions in the background",
              "Transactions appear in your list automatically",
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: "var(--color-primary)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{t}</p>
              </div>
            ))}
          </div>
        </div>

        {step === "error" && (
          <p className="px-4 py-3 rounded-2xl text-sm"
            style={{ background: "var(--color-error-container)", color: "var(--color-on-error-container)" }}>
            {error}
          </p>
        )}

        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-5 rounded-3xl font-semibold flex flex-col items-center gap-3 border-2 border-dashed transition-all"
          style={{ borderColor: "var(--color-primary)", background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}>picture_as_pdf</span>
          <span style={{ fontSize: 16 }}>Tap to choose PDF</span>
          <span style={{ fontSize: 12, color: "var(--color-on-surface-variant)", fontWeight: 400 }}>Max 20 MB · PDF only</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />

        <p style={{ fontSize: 12, color: "var(--color-outline)", textAlign: "center" }}>
          Works with HDFC, ICICI, Axis, SBI, and most Indian bank statements.
        </p>
      </div>
    </div>
  );
}
