"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ShortcutSettingsPage() {
  const router  = useRouter();
  const [token, setToken]   = useState("");
  const [copied, setCopied] = useState<"token" | "url" | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    fetch("/api/user/token").then((r) => r.json()).then((d) => setToken(d.token));
  }, []);

  async function rotateToken() {
    const res  = await fetch("/api/user/token", { method: "POST" });
    const data = await res.json();
    setToken(data.token);
  }

  function copy(value: string, key: "token" | "url") {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  const apiUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/shortcut`
    : "/api/shortcut";

  const masked = token
    ? `${token.slice(0, 8)}••••••••••••${token.slice(-4)}`
    : "Loading…";

  return (
    <div className="max-w-lg mx-auto px-5 pb-10">
      {/* Header */}
      <div className="md:hidden sticky top-0 z-30 flex items-center pt-10 pb-3 gap-3"
        style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()}
          className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Auto SMS Import</h1>
      </div>

      <div className="flex flex-col gap-5 pt-4">

        {/* Hero */}
        <div className="rounded-2xl p-4" style={{ background: "var(--color-primary-fixed)" }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 28, fontVariationSettings: "'FILL' 1" }}>sms</span>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-primary)" }}>Automatic SMS logging</p>
              <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>
                iPhone receives bank SMS → automatically sent to FundsFlee
              </p>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>
            Uses iOS Shortcuts Automation — no manual sharing needed, fully automatic.
          </p>
        </div>

        {/* Step 1 — Copy token */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 700 }}>1</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Copy your API token</p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
              You&apos;ll paste this into the automation to authenticate requests.
            </p>
            <div className="rounded-xl p-3" style={{ background: "#1b1b22" }}>
              <p style={{ fontFamily: "monospace", color: "#c3c0ff", fontSize: 12, wordBreak: "break-all", marginBottom: 10 }}>
                {showToken ? token : masked}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowToken(!showToken)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{showToken ? "visibility_off" : "visibility"}</span>
                  {showToken ? "Hide" : "Show"}
                </button>
                <button onClick={() => copy(token, "token")} disabled={!token}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-semibold"
                  style={{
                    background: copied === "token" ? "rgba(76,175,80,0.3)" : "var(--color-primary)",
                    color: "#fff", fontSize: 12,
                  }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{copied === "token" ? "check" : "content_copy"}</span>
                  {copied === "token" ? "Copied!" : "Copy Token"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 — Open Shortcuts */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 700 }}>2</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Create an Automation in Shortcuts</p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {[
                "Open the Shortcuts app and tap the Automation tab (bottom)",
                "Tap + → Create Personal Automation",
                'Scroll to "Message" and tap it',
                'Set the filter — e.g. "Message Contains" = HDFC, or "Sender Contains" = your bank number',
                "Tap Next",
              ].map((text, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: "var(--color-primary)" }} />
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => { window.location.href = "shortcuts://"; }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-medium"
              style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)", fontSize: 14 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
              Open Shortcuts App
            </button>
          </div>
        </div>

        {/* Step 3 — Add action */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 700 }}>3</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Add the HTTP request action</p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {[
                'Tap "Add Action" → search "Get Contents of URL" → add it',
                "Paste this URL into the action:",
              ].map((text, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: "var(--color-primary)" }} />
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{text}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-3 py-2 rounded-xl" style={{ background: "#1b1b22", color: "#c3c0ff", fontFamily: "monospace", wordBreak: "break-all" }}>
                {apiUrl}
              </code>
              <button onClick={() => copy(apiUrl, "url")}
                className="flex-shrink-0 p-2.5 rounded-xl"
                style={{ background: copied === "url" ? "#e8f5e9" : "var(--color-primary-fixed)", color: copied === "url" ? "#2e7d32" : "var(--color-primary)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{copied === "url" ? "check" : "content_copy"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Step 4 — Configure */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 700 }}>4</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Configure the request</p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2">
            {[
              { label: "Method", value: "POST" },
              { label: "Header key", value: "Authorization" },
              { label: "Header value", value: "Bearer <paste your token here>" },
              { label: "Body type", value: "JSON" },
              { label: "Body key", value: "text" },
              { label: "Body value", value: "Shortcut Input (tap the variable wand icon)" },
              { label: "Body key 2", value: "source" },
              { label: "Body value 2", value: "shortcut" },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-start gap-4 py-1.5"
                style={{ borderBottom: "1px solid var(--color-surface-variant)" }}>
                <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)", flexShrink: 0 }}>{label}</p>
                <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-on-surface)", textAlign: "right" }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Step 5 — Finish */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 700 }}>5</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Save & enable</p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2">
            {[
              "Tap Next",
              "Turn OFF \"Ask Before Running\" so it runs silently",
              "Tap Done",
            ].map((text, i) => (
              <div key={i} className="flex gap-2.5 py-1">
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: "var(--color-primary)" }} />
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{text}</p>
              </div>
            ))}
            <div className="mt-2 flex gap-2 rounded-xl p-3" style={{ background: "#e8f5e9" }}>
              <span className="material-symbols-outlined flex-shrink-0" style={{ color: "#2e7d32", fontSize: 16, marginTop: 1 }}>check_circle</span>
              <p style={{ fontSize: 12, color: "#2e7d32", fontWeight: 500 }}>
                Done! Every matching SMS will now be sent to FundsFlee automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Token management */}
        <div>
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}
            className="mb-2 px-1">Token management</p>
          <div className="rounded-2xl p-4 border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginBottom: 12 }}>
              If you regenerate your token you&apos;ll need to update it in the Shortcuts automation too.
            </p>
            <button onClick={rotateToken}
              className="w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--color-error-container)", color: "var(--color-error)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              Regenerate Token
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
