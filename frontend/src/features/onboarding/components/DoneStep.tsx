interface DoneStepProps {
  onFinish: () => void;
}

export function DoneStep({ onFinish }: DoneStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 flex-1">
      <div className="w-32 h-32 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 64, color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>celebration</span>
      </div>
      <div>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-3">You&apos;re all set!</h2>
        <p style={{ fontSize: 16, color: "var(--color-on-surface-variant)", lineHeight: 1.6 }}>
          Start by adding your first expense — snap a receipt, paste an SMS, or enter it manually.
        </p>
      </div>
      <div className="mt-auto w-full">
        <button
          onClick={onFinish}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}
        >
          <span className="material-symbols-outlined">home</span> Go to Dashboard
        </button>
      </div>
    </div>
  );
}
