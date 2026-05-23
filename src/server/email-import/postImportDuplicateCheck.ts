import { getTransactions, updateTransactionField } from "@/lib/sheets";
import { findDuplicates } from "@/lib/ai/dedup";
import type { SheetSession } from "@/server/services/types";

export async function deduplicateNewTransactions(
  session: SheetSession,
  newTxIds: string[]
): Promise<void> {
  if (newTxIds.length === 0) return;

  const { transactions: recentTxs } = await getTransactions(session.accessToken, session.sheetId, 1, 200);

  if (recentTxs.length < 2) return;

  const groups = await findDuplicates(recentTxs).catch(() => []);

  await Promise.all(
    groups.flatMap((group) =>
      group.duplicate_ids.map((dupId) =>
        updateTransactionField(session.accessToken, session.sheetId, dupId, {
          is_duplicate: true,
          duplicate_ref: group.original_id,
        }).catch(() => {})
      )
    )
  );
}
