interface WelcomeStepProps {
  userName: string;
  loading: boolean;
  onInitSheet: () => Promise<void>;
}

export function WelcomeStep({ userName, loading, onInitSheet }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 flex-1">
      <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
      </div>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-3">
          Welcome, {userName}!
        </h1>
        <p style={{ fontSize: 16, color: "var(--color-on-surface-variant)", lineHeight: 1.6 }}>
          FundsFlee will create a private Google Sheet in your Drive to store all your expenses. You own the data — always.
        </p>
      </div>
      <div className="w-full rounded-2xl p-4 flex flex-col gap-3" style={{ background: "var(--color-surface-container)" }}>
        {[
          { icon: "table_chart", text: "Creates 'FundsFlee' sheet in your Google Drive" },
          { icon: "lock",        text: "Only you can access it — we never read it without your session" },
          { icon: "download",    text: "You can export or delete it anytime" },
        ].map(({ icon, text }) => (
          <div key={icon} className="flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>{icon}</span>
            <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{text}</p>
          </div>
        ))}
      </div>
      <div className="mt-auto w-full">
        <button
          onClick={onInitSheet}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-opacity"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> Creating your sheet…</>
          ) : (
            <><span className="material-symbols-outlined">arrow_forward</span> Create my FundsFlee</>
          )}
        </button>
      </div>
    </div>
  );
}
