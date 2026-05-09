"use client";

import { useState, useRef, Suspense } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useRouter, useSearchParams } from "next/navigation";
import type { ParsedTransaction, PaymentMethod } from "@/types";

// ── Paste/SMS confirm form (unchanged) ───────────────────────────────────────

function ConfirmForm({ parsed, rawText, onBack }: { parsed: ParsedTransaction; rawText: string; onBack: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(parsed);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof ParsedTransaction>(key: K, val: ParsedTransaction[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function save() {
    setSaving(true);

    const tx = {
      id: crypto.randomUUID(),
      date: form.date, time: form.time, amount: form.amount,
      merchant: form.merchant, category: form.category,
      subcategory: form.subcategory, item_name: form.item_name,
      payment_method: form.payment_method,
      source: "sms" as const, raw_input: rawText, status: "done" as const,
    };

    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: tx }),
    });

    setSaving(false);
    if (res.ok) router.push("/transactions");
    else alert("Failed to save");
  }

  const isUncertain = (field: string) => (form.uncertain_fields ?? []).includes(field);

  function field(label: string, key: keyof ParsedTransaction, type = "text") {
    return (
      <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
        <div className="flex items-center gap-2 mb-1">
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>{label}</label>
          {isUncertain(key as string) && (
            <span style={{ fontSize: 11, background: "#fff3e0", color: "#e65100", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>Verify</span>
          )}
        </div>
        <input
          type={type}
          value={String(form[key] ?? "")}
          onChange={(e) => update(key, e.target.value as ParsedTransaction[typeof key])}
          className="w-full bg-transparent focus:outline-none font-medium"
          style={{ fontSize: 16, color: "var(--color-on-surface)" }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        <span style={{ fontSize: 13, color: "var(--color-primary)", fontWeight: 600 }}>Extracted by AI</span>
        <span className="ml-auto" style={{ fontSize: 12, color: "var(--color-outline)" }}>Confidence: {Math.round((form.confidence ?? 0) * 100)}%</span>
      </div>

      <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        {field("Merchant", "merchant")}
        {field("Item Name", "item_name")}
        <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Amount (₹)</label>
          <input type="number" value={form.amount} onChange={(e) => update("amount", parseFloat(e.target.value))}
            className="w-full bg-transparent focus:outline-none font-semibold"
            style={{ fontSize: 24, color: "var(--color-primary)" }} />
        </div>
        {field("Date", "date", "date")}
        {field("Category", "category")}
        <div className="p-4">
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Payment Method</label>
          <div className="flex gap-2 flex-wrap mt-2">
            {(["UPI", "Card", "Cash", "NetBanking", "Other"] as PaymentMethod[]).map((m) => (
              <button key={m} onClick={() => update("payment_method", m)}
                className="px-3 py-1.5 rounded-full text-sm font-medium"
                style={{ background: form.payment_method === m ? "var(--color-primary)" : "var(--color-surface-container)", color: form.payment_method === m ? "#fff" : "var(--color-on-surface-variant)" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-2">
        <button onClick={onBack} className="flex-1 py-4 rounded-2xl font-semibold"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}>Edit</button>
        <button onClick={save} disabled={saving} className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, flex: 2, opacity: saving ? 0.7 : 1 }}>
          {saving ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Saving</> : <><span className="material-symbols-outlined">check</span>Save</>}
        </button>
      </div>
    </div>
  );
}

// ── Main capture content ──────────────────────────────────────────────────────

function CaptureContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [tab, setTab] = useState<"paste" | "camera">(
    (searchParams.get("tab") as "paste" | "camera") ?? "paste"
  );

  // Paste/SMS state
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedTransaction | null>(null);

  // Camera / upload state
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  const region = typeof window !== "undefined" ? localStorage.getItem("region") ?? "" : "";

  // ── Paste/SMS ──

  async function parseText() {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/parse/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, region }),
      });
      const data = await res.json();
      setParsed(data.extracted);
    } catch {
      alert("Failed to parse. Try again.");
    } finally {
      setParsing(false);
    }
  }

  // ── Receipt camera (async) ──

  async function handleReceiptFile(file: File) {
    setUploadState("uploading");
    setUploadMsg("Saving to Drive…");

    try {
      const formData = new FormData();
      formData.append("image", file);

      // Step 1: Upload to Drive + create queued entry (~2s)
      const uploadRes = await fetch("/api/receipts/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { txId } = await uploadRes.json();

      setUploadMsg("Saved! AI is reading your receipt in the background…");
      setUploadState("done");

      // Step 2: Trigger processing in the background (don't await)
      fetch("/api/receipts/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId, region }),
      }).catch(() => {/* processing will show as "failed" in transaction list */});

      // Navigate to transactions after short delay so user sees the message
      setTimeout(() => router.push("/transactions"), 1500);
    } catch {
      setUploadState("error");
      setUploadMsg("Upload failed. Try again.");
    }
  }

  // ── Camera ──

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      fileRef.current?.click();
    }
  }

  async function capturePhoto() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const stream = videoRef.current.srcObject as MediaStream;
    stream?.getTracks().forEach((t) => t.stop());
    setCameraActive(false);

    canvas.toBlob((blob) => {
      if (blob) handleReceiptFile(new File([blob], "receipt.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  // ── Parsed SMS confirm view ──
  if (parsed) {
    return <ConfirmForm parsed={parsed} rawText={text} onBack={() => setParsed(null)} />;
  }

  // ── Camera fullscreen view ──
  if (cameraActive) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        <video ref={videoRef} className="flex-1 object-cover w-full" playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-48 border-2 border-white/60 rounded-2xl"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }} />
        </div>
        <div className="absolute top-4 left-4">
          <button onClick={() => { const s = videoRef.current?.srcObject as MediaStream; s?.getTracks().forEach((t) => t.stop()); setCameraActive(false); }}
            className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <span className="material-symbols-outlined text-white">close</span>
          </button>
        </div>
        <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-8">
          <button onClick={() => fileRef.current?.click()}
            className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
            <span className="material-symbols-outlined text-white">photo_library</span>
          </button>
          <button onClick={capturePhoto}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center" style={{ background: "var(--color-primary)" }}>
            <span className="material-symbols-outlined text-white" style={{ fontSize: 32 }}>camera</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Upload feedback overlay ──
  if (uploadState !== "idle") {
    return (
      <div className="max-w-lg mx-auto px-5 flex flex-col items-center justify-center gap-6 pt-20">
        {uploadState === "uploading" && (
          <div className="w-20 h-20 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        )}
        {uploadState === "done" && (
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "#e8f5e9" }}>
            <span className="material-symbols-outlined" style={{ color: "#2e7d32", fontSize: 40, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          </div>
        )}
        {uploadState === "error" && (
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 40 }}>error</span>
          </div>
        )}
        <div className="text-center">
          <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }} className="mb-2">
            {uploadState === "uploading" ? "Uploading receipt…" : uploadState === "done" ? "Receipt saved!" : "Upload failed"}
          </p>
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{uploadMsg}</p>
        </div>
        {uploadState === "error" && (
          <button onClick={() => setUploadState("idle")}
            className="px-6 py-3 rounded-2xl font-medium"
            style={{ background: "var(--color-primary)", color: "#fff" }}>
            Try again
          </button>
        )}
      </div>
    );
  }

  // ── Main UI ──
  return (
    <div className="max-w-lg mx-auto px-5 flex flex-col gap-4">
      <div className="md:hidden flex items-center pt-10 pb-2 gap-3">
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Smart Capture</h1>
      </div>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ background: "var(--color-surface-container)", border: "1px solid var(--color-outline-variant)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>wifi_off</span>
          <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
            AI parsing requires internet. You can still save entries manually in Add.
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-2">
        {(["camera", "paste"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all"
            style={{ background: tab === t ? "var(--color-primary)" : "var(--color-surface-container)", color: tab === t ? "#fff" : "var(--color-on-surface-variant)", fontSize: 14 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t === "camera" ? "photo_camera" : "content_paste"}</span>
            {t === "camera" ? "Camera" : "Paste Text"}
          </button>
        ))}
      </div>

      {/* Camera tab */}
      {tab === "camera" && (
        <>
          <div className="rounded-3xl overflow-hidden flex flex-col items-center justify-center gap-4 cursor-pointer"
            style={{ background: "var(--color-surface-container)", minHeight: 240 }}
            onClick={startCamera}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-primary)" }}>photo_camera</span>
            </div>
            <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>Tap to open camera</p>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Point at a receipt or bill</p>
          </div>

          <button onClick={() => fileRef.current?.click()}
            className="w-full py-3 rounded-2xl font-medium flex items-center justify-center gap-2"
            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>photo_library</span>
            Upload from gallery
          </button>

          {/* How it works */}
          <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "var(--color-primary-fixed)" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }}>How it works</p>
            {[
              { icon: "photo_camera", text: "Take a photo of any receipt or bill" },
              { icon: "cloud_upload", text: "Instantly saved to your Google Drive" },
              { icon: "auto_awesome", text: "AI reads it in the background — no waiting" },
              { icon: "check_circle", text: "Transaction appears in your list automatically" },
            ].map(({ icon, text }) => (
              <div key={icon} className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{text}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Paste tab */}
      {tab === "paste" && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"Paste your SMS or email here…\n\nExample:\nDear Customer, INR 450 debited from your account for Swiggy UPI transaction on 26-04-2025."}
            rows={7}
            className="w-full p-4 rounded-2xl resize-none focus:outline-none"
            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, lineHeight: 1.6, border: "2px solid transparent" }}
            onFocus={(e) => e.target.style.borderColor = "var(--color-primary)"}
            onBlur={(e) => e.target.style.borderColor = "transparent"} />

          <button onClick={parseText} disabled={parsing || !text.trim()}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, opacity: parsing || !text.trim() ? 0.6 : 1 }}>
            {parsing
              ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Parsing…</>
              : <><span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>Parse with AI</>}
          </button>

          <div className="rounded-2xl p-4" style={{ background: "var(--color-surface-container)" }}>
            <p className="font-semibold mb-2" style={{ fontSize: 13, color: "var(--color-on-surface)" }}>Works with:</p>
            {["HDFC / ICICI / Axis / SBI bank SMS", "UPI alerts (GPay, PhonePe, Paytm)", "Swiggy, Zomato, Amazon, Flipkart emails", "Any payment notification text"].map((t) => (
              <div key={t} className="flex items-center gap-2 mt-1.5">
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{t}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); }} />
    </div>
  );
}

export default function CapturePage() {
  return <Suspense><CaptureContent /></Suspense>;
}
