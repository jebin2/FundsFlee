interface SheetStepProps {
  sheetUrl: string;
  userName: string;
  onContinue: () => void;
}

export function SheetStep({ sheetUrl, userName, onContinue }: SheetStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 flex-1">
      <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: "#e8f5e9" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: "#2e7d32", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      </div>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-2">Sheet created!</h2>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>Your private spending sheet is ready.</p>
      </div>
      <div className="w-full rounded-2xl p-4 border flex items-center gap-4" style={{ background: "var(--color-surface-container-lowest)", borderColor: "var(--color-outline-variant)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 32, color: "#2e7d32" }}>table_chart</span>
        <div className="text-left flex-1">
          <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>FundsFlee — {userName}</p>
          <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>Google Sheets · Your Drive</p>
        </div>
      </div>
      {sheetUrl && (
        <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2" style={{ color: "var(--color-primary)", fontSize: 14 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
          Open in Google Sheets
        </a>
      )}
      <div className="mt-auto w-full">
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16 }}
        >
          <span className="material-symbols-outlined">arrow_forward</span> Continue
        </button>
      </div>
    </div>
  );
}
