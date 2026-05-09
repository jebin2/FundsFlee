import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTransactions, updateTransactionField, getMetaValues, setMetaValue } from "@/lib/sheets";
import { findDuplicates } from "@/lib/ai/dedup";

async function runDetection(accessToken: string, sheetId: string) {
  try {
    const transactions = await getTransactions(accessToken, sheetId);

    // Reset previous duplicate flags before re-running
    const previousDups = transactions.filter((t) => t.is_duplicate);
    await Promise.all(
      previousDups.map((t) =>
        updateTransactionField(accessToken, sheetId, t.id, { is_duplicate: false, duplicate_ref: undefined })
      )
    );

    const groups = await findDuplicates(transactions);

    // Mark duplicates in sheet
    await Promise.all(
      groups.flatMap((g) =>
        g.duplicate_ids.map((dupId) =>
          updateTransactionField(accessToken, sheetId, dupId, {
            is_duplicate: true,
            duplicate_ref: g.original_id,
          })
        )
      )
    );

    await setMetaValue(accessToken, sheetId, "last_dedup_checked_at", new Date().toISOString());
  } catch (err) {
    console.error("Duplicate detection error:", err);
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const meta = await getMetaValues(session.access_token, session.sheet_id);
  const lastRun = meta.last_dedup_checked_at;
  const today = new Date().toISOString().split("T")[0];

  // Run at most once per day
  if (lastRun && lastRun.startsWith(today)) {
    return NextResponse.json({ skipped: true });
  }

  // Fire background — return immediately
  runDetection(session.access_token, session.sheet_id);
  return NextResponse.json({ started: true });
}
