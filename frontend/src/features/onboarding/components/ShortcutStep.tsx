interface ShortcutStepProps {
  token: string;
  onSkip: () => void;
  onDone: () => void;
}

export function ShortcutStep({ token, onSkip, onDone }: ShortcutStepProps) {
  return (
    <div className="flex flex-col gap-5 flex-1">
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-1">iPhone Shortcut</h2>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>Auto-log spending by sharing any SMS or email</p>
      </div>
      <div className="rounded-2xl p-4" style={{ background: "var(--color-primary-fixed)" }}>
        <div className="flex items-center justify-around">
          {[{ emoji: "📱", label: "Get SMS" }, { emoji: "📤", label: "Tap Share" }, { emoji: "✨", label: "Auto-logged" }].map(({ emoji, label }, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "rgba(255,255,255,0.6)" }}>{emoji}</div>
                <p style={{ fontSize: 11, color: "var(--color-primary)", fontWeight: 500 }}>{label}</p>
              </div>
              {i < 2 && <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", opacity: 0.5, fontSize: 18 }}>arrow_forward</span>}
            </div>
          ))}
        </div>
      </div>
      {token && (
        <div className="rounded-2xl p-4" style={{ background: "#1b1b22" }}>
          <p style={{ fontFamily: "monospace", color: "#c3c0ff", fontSize: 13, letterSpacing: "0.05em" }} className="mb-3">
            {token.slice(0, 20)}••••••••••••{token.slice(-6)}
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(token)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, border: "1px solid rgba(255,255,255,0.2)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_copy</span> Copy token
          </button>
        </div>
      )}
      <div className="mt-auto flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 py-4 rounded-2xl font-semibold"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}
        >
          Set up later
        </button>
        <button
          onClick={onDone}
          className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center gap-2"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, flex: 2 }}
        >
          <span className="material-symbols-outlined">arrow_forward</span> Done
        </button>
      </div>
    </div>
  );
}
