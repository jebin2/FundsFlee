"use client";

import { useEffect, useState } from "react";
import type { Transaction } from "@/types";
import { BottomSheet, BottomSheetHeader, NESTED_LAYER } from "@/components/ui/BottomSheet";
import { Spinner } from "@/components/ui/Spinner";
import { formatINR } from "@/lib/format/currency";
import { emailApi, type RerunPreview } from "@/lib/api/email";

interface RerunEmailSheetProps {
  tx: Transaction;
  onClose: () => void;
  onDone: () => void;
}

// One mail can hold several payments, so re-reading it can replace rows the
// person edited by hand. The preview is what makes that a choice rather than a
// surprise — it is loaded before anything is written.
export function RerunEmailSheet({ tx, onClose, onDone }: RerunEmailSheetProps) {
  const [preview, setPreview] = useState<RerunPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let live = true;
    emailApi
      .rerunPreview(tx.id)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(body.detail ?? "Could not load this email.");
        else setPreview(body as RerunPreview);
      })
      .catch(() => live && setError("Could not load this email."));
    return () => {
      live = false;
    };
  }, [tx.id]);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await emailApi.rerun(tx.id);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "Re-run failed.");
        return;
      }
      onDone();
    } catch {
      setError("Re-run failed.");
    } finally {
      setRunning(false);
    }
  }

  const affected = preview?.transactions ?? [];
  // Already running elsewhere — the server refuses a second one, so the button
  // says so instead of offering a click that can only fail.
  const busy = running || (preview?.rerunning ?? false);
  const editedCount = affected.filter((t) => t.edited).length;

  return (
    <BottomSheet onClose={onClose} maxHeight="70vh" layer={NESTED_LAYER}>
      <BottomSheetHeader
        title="Re-read this email?"
        subtitle={preview?.subject}
        onClose={onClose}
      />

      <div className="overflow-y-auto flex-1 px-5 pb-5">
        {!preview && !error && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {error && (
          <div
            className="flex items-start gap-2 px-4 py-3 rounded-2xl mb-4"
            style={{ background: "var(--color-error-container)" }}
          >
            <span
              className="material-symbols-outlined"
              style={{ color: "var(--color-error)", fontSize: 18 }}
            >
              error
            </span>
            <p style={{ fontSize: 13, color: "var(--color-on-error-container)" }}>{error}</p>
          </div>
        )}

        {preview && (
          <>
            {preview.rerunning && (
              <p
                style={{ fontSize: 13, color: "var(--color-on-surface-variant)", lineHeight: 1.5 }}
                className="mb-3"
              >
                This email is already being re-read. It will finish on its own —
                close this and pull to refresh in a moment.
              </p>
            )}
            <p
              style={{ fontSize: 13, color: "var(--color-on-surface-variant)", lineHeight: 1.5 }}
              className="mb-3"
            >
              The email will be read again from Gmail. These{" "}
              {affected.length === 1 ? "transaction is" : `${affected.length} transactions are`}{" "}
              replaced by whatever the fresh parse finds.
            </p>

            <div className="flex flex-col gap-2">
              {affected.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-4 py-3 rounded-2xl"
                  style={{ background: "var(--color-surface-container)" }}
                >
                  <div className="min-w-0">
                    <p
                      style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}
                      className="truncate"
                    >
                      {t.merchant || "Unknown"}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>
                      {t.date}
                      {t.edited && " · edited by hand"}
                    </p>
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: t.edited ? "var(--color-error)" : "var(--color-on-surface)",
                    }}
                  >
                    {typeof t.amount === "number" ? formatINR(t.amount) : "—"}
                  </p>
                </div>
              ))}
            </div>

            {/* Named explicitly: an edit is the one thing here that cannot be
                recovered from the email. */}
            {editedCount > 0 && (
              <p
                style={{ fontSize: 12, color: "var(--color-error)", lineHeight: 1.5 }}
                className="mt-3"
              >
                {editedCount === 1
                  ? "One of these was edited by hand. That edit will be lost."
                  : `${editedCount} of these were edited by hand. Those edits will be lost.`}
              </p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl font-medium"
                style={{
                  background: "var(--color-surface-container)",
                  color: "var(--color-on-surface-variant)",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={busy || affected.length === 0}
                className="flex-1 py-3 rounded-2xl font-medium"
                style={{
                  background: "var(--color-primary)",
                  color: "var(--color-on-primary)",
                  fontSize: 14,
                  opacity: busy || affected.length === 0 ? 0.6 : 1,
                }}
              >
                {busy ? "Re-reading…" : "Re-read"}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
