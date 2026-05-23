const LIFESTYLE_TAGS = [
  { emoji: "🌱", label: "Vegetarian" },
  { emoji: "💰", label: "Budget-conscious" },
  { emoji: "🎓", label: "Student" },
  { emoji: "✈️", label: "Frequent traveller" },
  { emoji: "👨‍👩‍👧", label: "Family" },
  { emoji: "🏃", label: "Health-conscious" },
  { emoji: "👴", label: "Senior" },
  { emoji: "🌙", label: "Night owl" },
];

interface ProfileStepProps {
  region: string;
  setRegion: (r: string) => void;
  tags: string[];
  toggleTag: (tag: string) => void;
  onSkip: () => void;
  onContinue: () => Promise<void>;
}

export function ProfileStep({ region, setRegion, tags, toggleTag, onSkip, onContinue }: ProfileStepProps) {
  return (
    <div className="flex flex-col gap-5 flex-1">
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-1">Tell us about you</h2>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>Helps the AI give you relevant local tips</p>
      </div>
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        <div className="p-4 border-b" style={{ borderColor: "var(--color-outline-variant)" }}>
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>City / Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="e.g. Chennai, Tamil Nadu"
            className="w-full bg-transparent mt-1 focus:outline-none"
            style={{ fontSize: 16, color: "var(--color-on-surface)" }}
          />
        </div>
        <button
          onClick={() => {
            navigator.geolocation?.getCurrentPosition(async (pos) => {
              const { latitude, longitude } = pos.coords;
              const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
              const data = await res.json();
              setRegion(data.address?.city || data.address?.state || "India");
            });
          }}
          className="w-full flex items-center gap-3 px-4 py-3"
          style={{ color: "var(--color-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1", fontSize: 20 }}>my_location</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Auto-detect my location</span>
        </button>
      </div>

      <div>
        <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="mb-3">Lifestyle tags</p>
        <div className="grid grid-cols-2 gap-2">
          {LIFESTYLE_TAGS.map(({ emoji, label }) => (
            <button
              key={label}
              onClick={() => toggleTag(label)}
              className="py-3 px-4 rounded-2xl flex items-center gap-2 justify-center transition-colors"
              style={{
                background: tags.includes(label) ? "var(--color-primary)" : "var(--color-surface-container)",
                color: tags.includes(label) ? "var(--color-on-primary)" : "var(--color-on-surface)",
                fontSize: 14,
              }}
            >
              <span>{emoji}</span> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-4 flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 py-4 rounded-2xl font-semibold"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}
        >
          Skip
        </button>
        <button
          onClick={onContinue}
          className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center gap-2"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, flex: 2 }}
        >
          <span className="material-symbols-outlined">arrow_forward</span> Continue
        </button>
      </div>
    </div>
  );
}
