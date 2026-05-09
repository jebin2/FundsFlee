import {
  getItemSuggestions,
  getTransactions,
  resolveItemSuggestion,
  updateTransactionField,
} from "@/lib/sheets";
import type { PendingSuggestion, SuggestionField } from "@/types";
import type { SheetSession } from "./types";

interface ResolveSuggestionRequest {
  key: string;
  field: SuggestionField;
  action: "accept" | "reject";
}

export async function getPendingSuggestions(session: SheetSession): Promise<PendingSuggestion[]> {
  const [suggestions, transactions] = await Promise.all([
    getItemSuggestions(session.accessToken, session.sheetId),
    getTransactions(session.accessToken, session.sheetId),
  ]);

  return suggestions
    .filter((suggestion) => suggestion.status === "pending" && suggestion.suggested !== suggestion.current_val)
    .map((suggestion) => {
      const tx_ids = suggestion.source === "normalize"
        ? transactions
            .filter((tx) => tx.item_name?.toLowerCase() === suggestion.current_val.toLowerCase())
            .map((tx) => tx.id)
        : undefined;

      return {
        key: suggestion.key,
        field: suggestion.field,
        current_val: suggestion.current_val,
        suggested: suggestion.suggested,
        source: suggestion.source,
        tx_ids,
      };
    });
}

export async function resolvePendingSuggestion(
  session: SheetSession,
  request: ResolveSuggestionRequest
): Promise<void> {
  if (request.action === "accept") {
    const suggestions = await getItemSuggestions(session.accessToken, session.sheetId);
    const suggestion = suggestions.find((item) => item.key === request.key && item.field === request.field);

    if (suggestion) {
      const transactions = await getTransactions(session.accessToken, session.sheetId);

      if (suggestion.source === "normalize") {
        const toUpdate = transactions.filter(
          (tx) => tx.item_name?.toLowerCase() === suggestion.current_val.toLowerCase()
        );
        await Promise.all(
          toUpdate.map((tx) =>
            updateTransactionField(session.accessToken, session.sheetId, tx.id, {
              [request.field]: suggestion.suggested,
            })
          )
        );
      } else {
        const txId = request.key.replace(/^tx:/, "");
        const tx = transactions.find((item) => item.id === txId);
        if (tx) {
          await updateTransactionField(session.accessToken, session.sheetId, txId, {
            [request.field]: suggestion.suggested,
          });
        }
      }
    }
  }

  await resolveItemSuggestion(
    session.accessToken,
    session.sheetId,
    request.key,
    request.field,
    request.action === "accept" ? "accepted" : "rejected"
  );
}
