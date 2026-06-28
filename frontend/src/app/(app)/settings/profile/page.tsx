"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";

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

export default function ProfileSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { profile, loading, saving, save } = useProfile();

  const [region, setRegion] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [income, setIncome] = useState("");

  // Populate local form state once profile loads from sheet
  useEffect(() => {
    if (loading) return;
    void (async () => {
      setRegion(profile.region);
      setTags(profile.lifestyle_tags);
      setIncome(profile.monthly_income ? String(profile.monthly_income) : "");
    })();
  }, [loading, profile]);

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  async function handleSave() {
    const ok = await save({
      region,
      lifestyle_tags: tags,
      monthly_income: income ? parseFloat(income) : null,
      name: session?.user?.name ?? "",
    });
    if (ok) router.back();
  }

  return (
    <div className="max-w-lg mx-auto px-5 pb-28">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between pt-10 pb-3" style={{ background: "var(--color-background)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
          </button>
          <h1 className="font-semibold" style={{ fontSize: 20 }}>Profile</h1>
        </div>
        <button onClick={handleSave} disabled={saving} style={{ color: "var(--color-primary)", fontWeight: 600 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        </div>
      ) : (
        <>
          {/* Avatar */}
          <div className="flex flex-col items-center py-6 gap-3">
            {session?.user?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image ?? ""} alt="" className="w-20 h-20 rounded-2xl object-cover border-2" style={{ borderColor: "var(--color-outline-variant)" }} />
            )}
            <p style={{ fontSize: 12, color: "var(--color-outline)" }}>Photo from your Google account</p>
          </div>

          <div className="flex flex-col gap-4">
            {/* Account info (read-only) */}
            <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
                <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Display name</label>
                <p className="mt-1 font-medium" style={{ fontSize: 16, color: "var(--color-on-surface)" }}>{session?.user?.name}</p>
              </div>
              <div className="p-4">
                <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Email</label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 16 }}>lock</span>
                  <p style={{ fontSize: 16, color: "var(--color-on-surface-variant)" }}>{session?.user?.email}</p>
                </div>
              </div>
            </div>

            {/* Location */}
            <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Your location</p>
            <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
                <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>City / Region</label>
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. Chennai, Tamil Nadu"
                  className="w-full bg-transparent focus:outline-none mt-1"
                  style={{ fontSize: 16, color: "var(--color-on-surface)" }}
                />
              </div>
              <button
                onClick={() => navigator.geolocation?.getCurrentPosition(async (pos) => {
                  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
                  const data = await res.json();
                  setRegion(data.address?.city || data.address?.state || "India");
                })}
                className="w-full flex items-center gap-3 px-4 py-3.5"
              >
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontVariationSettings: "'FILL' 1", fontSize: 20 }}>my_location</span>
                <div className="text-left">
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>Auto-detect my location</p>
                  <p style={{ fontSize: 12, color: "var(--color-outline)" }}>Updates city for AI suggestions</p>
                </div>
              </button>
            </div>

            {/* Lifestyle tags */}
            <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Lifestyle tags</p>
            <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }} className="-mt-2 px-1">These help the AI give you relevant tips</p>
            <div className="grid grid-cols-2 gap-2">
              {lifestyleTags.map(({ emoji, label }) => (
                <button
                  key={label}
                  onClick={() => toggleTag(label)}
                  className="py-3 px-4 rounded-2xl flex items-center gap-2 justify-center transition-colors"
                  style={{
                    background: tags.includes(label) ? "var(--color-primary)" : "var(--color-surface-container)",
                    color: tags.includes(label) ? "#fff" : "var(--color-on-surface)",
                    fontSize: 14,
                  }}
                >
                  <span>{emoji}</span> {label}
                </button>
              ))}
            </div>

            {/* Monthly income */}
            <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Income (optional)</p>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Monthly income</label>
              <div className="flex items-center gap-2 mt-1">
                <span style={{ fontSize: 16, color: "var(--color-on-surface-variant)" }}>₹</span>
                <input
                  type="number"
                  value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  placeholder="Helps estimate savings rate"
                  className="flex-1 bg-transparent focus:outline-none"
                  style={{ fontSize: 16, color: "var(--color-on-surface)" }}
                />
              </div>
              <p style={{ fontSize: 12, color: "var(--color-outline)" }} className="mt-2">Stored in your Google Sheet only</p>
            </div>
          </div>
        </>
      )}

      {/* Bottom save bar */}
      <div className="fixed bottom-0 left-0 w-full px-5 py-4 md:hidden" style={{ background: "rgba(252,248,255,0.95)", backdropFilter: "blur(10px)", borderTop: "1px solid var(--color-outline-variant)" }}>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, opacity: saving || loading ? 0.7 : 1 }}
        >
          {saving ? (
            <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> Saving to Sheet…</>
          ) : "Save Profile"}
        </button>
      </div>
    </div>
  );
}
