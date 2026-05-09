import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTransactions,
  getItemSuggestions,
  appendItemSuggestions,
  getMetaValues,
  setMetaValue,
} from "@/lib/sheets";
import { normalizeItemNames } from "@/lib/ai/normalize-items";
import { extractFromNotes } from "@/lib/ai/parse-notes";
import type { ItemSuggestion } from "@/lib/sheets";

const RUN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BATCH = 50;

async function runNormalization(accessToken: string, sheetId: string) {
  try {
    const [allTx, existing] = await Promise.all([
      getTransactions(accessToken, sheetId),
      getItemSuggestions(accessToken, sheetId),
    ]);

    const activeTx = allTx;

    // Build sets of already-processed values to avoid re-work
    // normalize: track by current_val (item name) — key is now tx:{id} so we can't use key prefix
    const processedItemNames = new Set(
      existing.filter((s) => s.source === "normalize").map((s) => s.current_val.toLowerCase())
    );
    const processedTxKeys = new Set(
      existing.filter((s) => s.source === "notes").map((s) => s.key)
    );

    const toAdd: Omit<ItemSuggestion, "status" | "updated_at">[] = [];

    // ── 1. Item name normalization ─────────────────────────────────────────
    const allItemNames = [
      ...new Set(activeTx.filter((t) => t.item_name).map((t) => t.item_name!)),
    ];
    const newItemNames = allItemNames.filter(
      (n) => !processedItemNames.has(n.toLowerCase())
    );

    for (let i = 0; i < newItemNames.length; i += BATCH) {
      const batch = newItemNames.slice(i, i + BATCH);
      const groups = await normalizeItemNames(batch);

      for (const g of groups) {
        for (const variant of g.variants) {
          if (variant.toLowerCase() === g.canonical.toLowerCase()) continue;
          // Use the first tx with this item name as the representative key
          const repTx = activeTx.find((t) => t.item_name?.toLowerCase() === variant.toLowerCase());
          if (!repTx) continue;
          toAdd.push({
            key: `tx:${repTx.id}`,
            field: "item_name",
            current_val: variant,
            suggested: g.canonical,
            source: "normalize",
          });
        }
      }

      // Mark ALL names in this batch as processed (even if no suggestion)
      for (const name of batch) {
        if (!toAdd.find((s) => s.current_val.toLowerCase() === name.toLowerCase() && s.source === "normalize")) {
          const repTx = activeTx.find((t) => t.item_name?.toLowerCase() === name.toLowerCase());
          if (!repTx) continue;
          toAdd.push({
            key: `tx:${repTx.id}`,
            field: "item_name",
            current_val: name,
            suggested: name, // same = sentinel, no chip shown
            source: "normalize",
          });
        }
      }
    }

    // ── 2. Notes field parsing (per transaction) ───────────────────────────
    const txWithNotes = activeTx.filter((t) => {
      if (!t.notes || t.notes.trim().length < 5) return false;
      return !processedTxKeys.has(`tx:${t.id}`);
    });

    for (let i = 0; i < txWithNotes.length; i += BATCH) {
      const batch = txWithNotes.slice(i, i + BATCH);
      const extractions = await extractFromNotes(
        batch.map((t) => ({
          tx_id: t.id,
          item_name: t.item_name,
          notes: t.notes!,
          quantity: t.quantity,
          merchant: t.merchant === "Unknown" ? "" : t.merchant,
        }))
      );

      for (const tx of batch) {
        const ext = extractions[tx.id];

        // Always mark tx as processed to avoid re-running
        // Only add real suggestions if AI found something different from current
        if (ext?.item_name && ext.item_name !== tx.item_name) {
          toAdd.push({
            key: `tx:${tx.id}`,
            field: "item_name",
            current_val: tx.item_name ?? "",
            suggested: ext.item_name,
            source: "notes",
          });
        }
        if (ext?.quantity && ext.quantity !== tx.quantity) {
          toAdd.push({
            key: `tx:${tx.id}`,
            field: "quantity",
            current_val: tx.quantity ?? "",
            suggested: ext.quantity,
            source: "notes",
          });
        }
        if (ext?.merchant && ext.merchant !== tx.merchant && tx.merchant === "Unknown") {
          toAdd.push({
            key: `tx:${tx.id}`,
            field: "merchant",
            current_val: tx.merchant ?? "",
            suggested: ext.merchant,
            source: "notes",
          });
        }

        // Sentinel to mark tx as processed even with no suggestions
        const hasAnySuggestion = toAdd.some((s) => s.key === `tx:${tx.id}`);
        if (!hasAnySuggestion) {
          toAdd.push({
            key: `tx:${tx.id}`,
            field: "item_name",
            current_val: tx.item_name ?? "",
            suggested: tx.item_name ?? "", // same = processed, no chip shown
            source: "notes",
          });
        }
      }
    }

    if (toAdd.length > 0) {
      await appendItemSuggestions(accessToken, sheetId, toAdd);
    }

    await setMetaValue(accessToken, sheetId, "items_normalized_at", new Date().toISOString());
  } catch (err) {
    console.error("Normalization background error:", err);
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const meta = await getMetaValues(session.access_token, session.sheet_id);
  const lastRun = meta.items_normalized_at
    ? new Date(meta.items_normalized_at).getTime()
    : 0;

  if (Date.now() - lastRun < RUN_INTERVAL_MS) {
    return NextResponse.json({ skipped: true });
  }

  runNormalization(session.access_token, session.sheet_id).catch(() => {});
  return NextResponse.json({ started: true });
}
