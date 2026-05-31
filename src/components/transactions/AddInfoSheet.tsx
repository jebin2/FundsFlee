"use client";

import { useState, useRef, useEffect } from "react";
import type { Transaction } from "@/types";

interface AddInfoSheetProps {
  tx: Transaction;
  receiptId?: string;  // when set, replaces the receipt group instead of enriching a single tx
  onClose: () => void;
  onSubmitted: () => void;
}

export function AddInfoSheet({ tx, receiptId, onClose, onSubmitted }: AddInfoSheetProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Revoke Blob URL when it changes or on unmount to avoid memory leaks.
  useEffect(() => {
    return () => { if (imagePreview) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function removeImage() {
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const canSubmit = !submitting && (!!text.trim() || !!image);

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const region = localStorage.getItem("region") ?? "";
      const fd = new FormData();
      if (text.trim()) fd.append("text", text.trim());
      if (image) fd.append("image", image);
      fd.append("region", region);
      fd.append("txContext", JSON.stringify({
        merchant:       tx.merchant,
        amount:         tx.amount,
        date:           tx.date,
        time:           tx.time,
        payment_method: tx.payment_method,
        notes:          tx.notes,
      }));
      if (receiptId) fd.append("receiptId", receiptId);
      const res = await fetch(`/api/transactions/${receiptId ?? tx.id}/enrich`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Failed");
      onSubmitted();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[90] flex flex-col rounded-t-3xl overflow-hidden md:left-1/2 md:right-auto md:w-full md:max-w-2xl md:-translate-x-1/2"
        style={{ background: "var(--color-surface)", maxHeight: "85dvh" }}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-outline-variant)" }} />
        </div>

        <div className="px-5 pt-3 pb-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--color-surface-variant)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-on-surface-variant)" }}>close</span>
          </button>
          <div className="flex-1 min-w-0">
            <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--color-on-surface)" }}>Add more info</h3>
            <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{receiptId ? "AI will replace the receipt items in the background" : "AI will update this transaction in the background"}</p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0"
            style={{
              background: "var(--color-primary)",
              color: "var(--color-on-primary)",
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? "pointer" : "default",
            }}
          >
            {submitting ? "Sending…" : "Update"}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-8 flex flex-col gap-4 pt-1">
          {error && (
            <p
              className="text-sm px-3 py-2 rounded-xl"
              style={{ background: "var(--color-error-container)", color: "var(--color-on-error-container)" }}
            >
              {error}
            </p>
          )}

          <div>
            <p className="mb-2 text-sm font-medium" style={{ color: "var(--color-on-surface-variant)" }}>
              What did you buy?
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. 2 apples, 1 kg rice, birthday cake for Priya…"
              rows={4}
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none outline-none"
              style={{
                background: "var(--color-surface-variant)",
                color: "var(--color-on-surface)",
                border: "1.5px solid transparent",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium" style={{ color: "var(--color-on-surface-variant)" }}>
              Or attach a photo of the bill / product
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
            {imagePreview ? (
              <div className="relative rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", maxHeight: 240 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Selected" className="w-full object-cover" style={{ maxHeight: 240 }} />
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.6)" }}
                >
                  <span className="material-symbols-outlined text-white" style={{ fontSize: 16 }}>close</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl border"
                style={{
                  borderColor: "var(--color-outline-variant)",
                  background: "var(--color-surface-container-lowest)",
                  borderStyle: "dashed",
                  cursor: "pointer",
                }}
              >
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                  add_photo_alternate
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>
                  Capture or choose photo
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
