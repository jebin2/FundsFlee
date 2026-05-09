import { normalizeItemNames } from "@/lib/ai/normalize-items";
import { extractFromNotes } from "@/lib/ai/parse-notes";
import {
  appendItemSuggestions,
  getItemSuggestions,
  getMetaValues,
  getTransactions,
  setMetaValue,
  type ItemSuggestion,
} from "@/lib/sheets";
import type { SheetSession } from "./types";

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 50;

type NewSuggestion = Omit<ItemSuggestion, "status" | "updated_at">;

function processedNormalizeNames(suggestions: ItemSuggestion[]): Set<string> {
  return new Set(
    suggestions
      .filter((suggestion) => suggestion.source === "normalize")
      .map((suggestion) => suggestion.current_val.toLowerCase())
  );
}

function processedNoteKeys(suggestions: ItemSuggestion[]): Set<string> {
  return new Set(
    suggestions
      .filter((suggestion) => suggestion.source === "notes")
      .map((suggestion) => suggestion.key)
  );
}

export async function runItemNormalization(session: SheetSession): Promise<void> {
  try {
    const [transactions, existing] = await Promise.all([
      getTransactions(session.accessToken, session.sheetId),
      getItemSuggestions(session.accessToken, session.sheetId),
    ]);

    const processedItemNames = processedNormalizeNames(existing);
    const processedTxKeys = processedNoteKeys(existing);
    const toAdd: NewSuggestion[] = [];

    const allItemNames = [
      ...new Set(transactions.filter((tx) => tx.item_name).map((tx) => tx.item_name!)),
    ];
    const newItemNames = allItemNames.filter((name) => !processedItemNames.has(name.toLowerCase()));

    for (let i = 0; i < newItemNames.length; i += BATCH) {
      const batch = newItemNames.slice(i, i + BATCH);
      const groups = await normalizeItemNames(batch);

      for (const group of groups) {
        for (const variant of group.variants) {
          if (variant.toLowerCase() === group.canonical.toLowerCase()) continue;
          const representativeTx = transactions.find(
            (tx) => tx.item_name?.toLowerCase() === variant.toLowerCase()
          );
          if (!representativeTx) continue;
          toAdd.push({
            key: `tx:${representativeTx.id}`,
            field: "item_name",
            current_val: variant,
            suggested: group.canonical,
            source: "normalize",
          });
        }
      }

      for (const name of batch) {
        const alreadyAdded = toAdd.some(
          (suggestion) =>
            suggestion.current_val.toLowerCase() === name.toLowerCase() &&
            suggestion.source === "normalize"
        );
        if (alreadyAdded) continue;

        const representativeTx = transactions.find((tx) => tx.item_name?.toLowerCase() === name.toLowerCase());
        if (!representativeTx) continue;
        toAdd.push({
          key: `tx:${representativeTx.id}`,
          field: "item_name",
          current_val: name,
          suggested: name,
          source: "normalize",
        });
      }
    }

    const txWithNotes = transactions.filter((tx) => {
      if (!tx.notes || tx.notes.trim().length < 5) return false;
      return !processedTxKeys.has(`tx:${tx.id}`);
    });

    for (let i = 0; i < txWithNotes.length; i += BATCH) {
      const batch = txWithNotes.slice(i, i + BATCH);
      const extractions = await extractFromNotes(
        batch.map((tx) => ({
          tx_id: tx.id,
          item_name: tx.item_name,
          notes: tx.notes!,
          quantity: tx.quantity,
          merchant: tx.merchant === "Unknown" ? "" : tx.merchant,
        }))
      );

      for (const tx of batch) {
        const ext = extractions[tx.id];

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

        const hasAnySuggestion = toAdd.some((suggestion) => suggestion.key === `tx:${tx.id}`);
        if (!hasAnySuggestion) {
          toAdd.push({
            key: `tx:${tx.id}`,
            field: "item_name",
            current_val: tx.item_name ?? "",
            suggested: tx.item_name ?? "",
            source: "notes",
          });
        }
      }
    }

    if (toAdd.length > 0) {
      await appendItemSuggestions(session.accessToken, session.sheetId, toAdd);
    }

    await setMetaValue(session.accessToken, session.sheetId, "items_normalized_at", new Date().toISOString());
  } catch (err) {
    console.error("Normalization background error:", err);
  }
}

export async function requestItemNormalization(
  session: SheetSession
): Promise<{ skipped: true } | { started: true }> {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  const lastRun = meta.items_normalized_at ? new Date(meta.items_normalized_at).getTime() : 0;

  if (Date.now() - lastRun < RUN_INTERVAL_MS) {
    return { skipped: true };
  }

  runItemNormalization(session).catch(() => {});
  return { started: true };
}
