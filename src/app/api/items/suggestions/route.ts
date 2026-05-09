import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getItemSuggestions,
  resolveItemSuggestion,
  getTransactions,
  updateTransactionField,
} from "@/lib/sheets";
import type { SuggestionField } from "@/lib/sheets";

export interface PendingSuggestion {
  key: string;
  field: SuggestionField;
  current_val: string;
  suggested: string;
  source: "normalize" | "notes";
  // For normalize suggestions, tx_ids affected
  tx_ids?: string[];
}

// GET — return all actionable pending suggestions (skip same-value sentinels)
export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [suggestions, allTx] = await Promise.all([
    getItemSuggestions(session.access_token, session.sheet_id),
    getTransactions(session.access_token, session.sheet_id),
  ]);

  const activeTx = allTx;

  const pending: PendingSuggestion[] = suggestions
    .filter((s) =>
      s.status === "pending" &&
      s.suggested !== s.current_val  // filter out sentinels
    )
    .map((s) => {
      // For normalize suggestions, find all affected tx_ids
      const tx_ids = s.source === "normalize"
        ? activeTx
            .filter((t) => t.item_name?.toLowerCase() === s.current_val.toLowerCase())
            .map((t) => t.id)
        : undefined;
      return { key: s.key, field: s.field, current_val: s.current_val, suggested: s.suggested, source: s.source, tx_ids };
    });

  return NextResponse.json({ suggestions: pending });
}

// PATCH — accept or reject one field suggestion
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key, field, action } = await req.json() as {
    key: string;
    field: SuggestionField;
    action: "accept" | "reject";
  };

  if (action === "accept") {
    const suggestions = await getItemSuggestions(session.access_token, session.sheet_id);
    const s = suggestions.find((x) => x.key === key && x.field === field);
    if (s) {
      const allTx = await getTransactions(session.access_token, session.sheet_id);

      if (s.source === "normalize") {
        // Update ALL transactions with matching item_name
        const toUpdate = allTx.filter(
          (t) => t.item_name?.toLowerCase() === s.current_val.toLowerCase()
        );
        await Promise.all(
          toUpdate.map((t) =>
            updateTransactionField(session.access_token, session.sheet_id!, t.id, {
              [field]: s.suggested,
            })
          )
        );
      } else {
        // "tx:{tx_id}" — update just that transaction
        const txId = key.replace(/^tx:/, "");
        const tx = allTx.find((t) => t.id === txId);
        if (tx) {
          await updateTransactionField(session.access_token, session.sheet_id!, txId, {
            [field]: s.suggested,
          });
        }
      }
    }
  }

  await resolveItemSuggestion(session.access_token, session.sheet_id, key, field, action === "accept" ? "accepted" : "rejected");
  return NextResponse.json({ ok: true });
}
