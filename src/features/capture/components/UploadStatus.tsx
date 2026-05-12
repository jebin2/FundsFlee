import type { UploadState } from "@/features/capture/hooks/useReceiptUpload";

interface UploadStatusProps {
  state: Exclude<UploadState, "idle">;
  message: string;
  onRetry: () => void;
}

export function UploadStatus({ state, message, onRetry }: UploadStatusProps) {
  return (
    <div className="max-w-lg mx-auto px-5 flex flex-col items-center justify-center gap-6 pt-20">
      {state === "uploading" && (
        <div className="w-20 h-20 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
      )}
      {state === "done" && (
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "#e8f5e9" }}>
          <span className="material-symbols-outlined" style={{ color: "#2e7d32", fontSize: 40, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
      )}
      {state === "error" && (
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 40 }}>error</span>
        </div>
      )}
      <div className="text-center">
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }} className="mb-2">
          {state === "uploading" ? "Uploading receipt…" : state === "done" ? "Receipt saved!" : "Upload failed"}
        </p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{message}</p>
      </div>
      {state === "error" && (
        <button onClick={onRetry} className="px-6 py-3 rounded-2xl font-medium" style={{ background: "var(--color-primary)", color: "#fff" }}>
          Try again
        </button>
      )}
    </div>
  );
}
