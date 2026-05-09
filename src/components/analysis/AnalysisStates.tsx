"use client";

export type AsyncStatus = "loading" | "not_started" | "generating" | "done" | "failed";

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
        style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
    </div>
  );
}

export function GeneratingSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-10 gap-4">
      <div className="relative w-16 h-16">
        <div className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        <span className="material-symbols-outlined absolute inset-0 m-auto flex items-center justify-center"
          style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1", width: 20, height: 20 }}>psychology</span>
      </div>
      <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>{label}</p>
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "var(--color-surface-container)" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
        <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Checking every 5 seconds…</p>
      </div>
    </div>
  );
}

export function FailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 gap-4 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 26 }}>error</span>
      </div>
      <p style={{ fontSize: 16, fontWeight: 600 }}>Analysis failed</p>
      <button onClick={onRetry} className="px-6 py-3 rounded-2xl font-semibold flex items-center gap-2"
        style={{ background: "var(--color-primary)", color: "#fff" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Try again
      </button>
    </div>
  );
}
