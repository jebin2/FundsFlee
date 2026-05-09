"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const STEPS = ["welcome", "sheet", "profile", "shortcut", "done"] as const;
type Step = typeof STEPS[number];

export default function OnboardingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [token, setToken] = useState("");

  const stepIndex = STEPS.indexOf(step);

  const lifestyleTags = [
    { emoji: "🌱", label: "Vegetarian" },
    { emoji: "💰", label: "Budget-conscious" },
    { emoji: "🎓", label: "Student" },
    { emoji: "✈️", label: "Frequent traveller" },
    { emoji: "👨‍👩‍👧", label: "Family" },
    { emoji: "🏃", label: "Health-conscious" },
    { emoji: "👴", label: "Senior" },
    { emoji: "🌙", label: "Night owl" },
  ];

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

  async function loadToken() {
    const sid = sheetId || localStorage.getItem("sheetId") || "";
    const res = await fetch(`/api/user/token?sheetId=${sid}`);
    const data = await res.json();
    setToken(data.token);
  }

  async function saveProfileToSheet(sid: string) {
    if (!sid) return;
    await fetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: sid,
        name: session?.user?.name ?? "",
        region,
        lifestyle_tags: JSON.stringify(tags),
      }),
    });
  }

  useEffect(() => {
    if (step === "shortcut") loadToken();
  }, [step]);

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--color-background)" }}>
      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: "var(--color-surface-container)" }}>
        <div
          className="h-1 transition-all duration-500"
          style={{ background: "var(--color-primary)", width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-6 py-8">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="rounded-full transition-all"
              style={{
                width: i === stepIndex ? 24 : 8,
                height: 8,
                background: i <= stepIndex ? "var(--color-primary)" : "var(--color-outline-variant)",
              }}
            />
          ))}
        </div>

        {/* Step: Welcome */}
        {step === "welcome" && (
          <div className="flex flex-col items-center text-center gap-6 flex-1">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            </div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-on-background)" }} className="mb-3">
                Welcome, {session?.user?.name?.split(" ")[0]}!
              </h1>
              <p style={{ fontSize: 16, color: "var(--color-on-surface-variant)", lineHeight: 1.6 }}>
                SpendingTracker will create a private Google Sheet in your Drive to store all your expenses. You own the data — always.
              </p>
            </div>
            <div className="w-full rounded-2xl p-4 flex flex-col gap-3" style={{ background: "var(--color-surface-container)" }}>
              {[
                { icon: "table_chart", text: "Creates 'SpendingTracker' sheet in your Google Drive" },
                { icon: "lock", text: "Only you can access it — we never read it without your session" },
                { icon: "download", text: "You can export or delete it anytime" },
              ].map(({ icon, text }) => (
                <div key={icon} className="flex items-center gap-3">
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>{icon}</span>
                  <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{text}</p>
                </div>
              ))}
            </div>
            <div className="mt-auto w-full">
              <button
                onClick={initSheet}
                disabled={loading}
                className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, opacity: loading ? 0.7 : 1 }}
              >
                {loading ? (
                  <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> Creating your sheet…</>
                ) : (
                  <><span className="material-symbols-outlined">arrow_forward</span> Create my SpendingTracker</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step: Sheet created */}
        {step === "sheet" && (
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
                <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>SpendingTracker — {session?.user?.name}</p>
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
                onClick={() => setStep("profile")}
                className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16 }}
              >
                <span className="material-symbols-outlined">arrow_forward</span> Continue
              </button>
            </div>
          </div>
        )}

        {/* Step: Profile */}
        {step === "profile" && (
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
                {lifestyleTags.map(({ emoji, label }) => (
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
                onClick={() => setStep("shortcut")}
                className="flex-1 py-4 rounded-2xl font-semibold"
                style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}
              >
                Skip
              </button>
              <button
                onClick={async () => {
                  if (region) localStorage.setItem("region", region);
                  if (tags.length) localStorage.setItem("lifestyle_tags", JSON.stringify(tags));
                  const sid = sheetId || localStorage.getItem("sheetId") || "";
                  await saveProfileToSheet(sid);
                  setStep("shortcut");
                }}
                className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center gap-2"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, flex: 2 }}
              >
                <span className="material-symbols-outlined">arrow_forward</span> Continue
              </button>
            </div>
          </div>
        )}

        {/* Step: Shortcut */}
        {step === "shortcut" && (
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
                onClick={() => setStep("done")}
                className="flex-1 py-4 rounded-2xl font-semibold"
                style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}
              >
                Set up later
              </button>
              <button
                onClick={() => setStep("done")}
                className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center gap-2"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, flex: 2 }}
              >
                <span className="material-symbols-outlined">arrow_forward</span> Done
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
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
                onClick={() => router.replace("/dashboard")}
                className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}
              >
                <span className="material-symbols-outlined">home</span> Go to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
