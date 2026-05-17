interface PasteCapturePanelProps {
  text: string;
  onTextChange: (v: string) => void;
  onParse: () => void;
  parsing: boolean;
}

export function PasteCapturePanel({ text, onTextChange, onParse, parsing }: PasteCapturePanelProps) {
  return (
    <>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={"Paste your SMS or email here…\n\nExample:\nDear Customer, INR 450 debited from your account for Swiggy UPI transaction on 26-04-2025."}
        rows={7}
        className="w-full p-4 rounded-2xl resize-none focus:outline-none"
        style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, lineHeight: 1.6, border: "2px solid transparent" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--color-primary)")}
        onBlur={(e) => (e.target.style.borderColor = "transparent")}
      />

      <button
        onClick={onParse}
        disabled={parsing || !text.trim()}
        className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-opacity"
        style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, opacity: parsing || !text.trim() ? 0.6 : 1 }}
      >
        {parsing ? (
          <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Saving…</>
        ) : (
          <><span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>Log with AI</>
        )}
      </button>

      <div className="rounded-2xl p-4" style={{ background: "var(--color-surface-container)" }}>
        <p className="font-semibold mb-2" style={{ fontSize: 13, color: "var(--color-on-surface)" }}>Works with:</p>
        {[
          "HDFC / ICICI / Axis / SBI bank SMS",
          "UPI alerts (GPay, PhonePe, Paytm)",
          "Swiggy, Zomato, Amazon, Flipkart emails",
          "Any payment notification text",
        ].map((t) => (
          <div key={t} className="flex items-center gap-2 mt-1.5">
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{t}</p>
          </div>
        ))}
      </div>
    </>
  );
}
