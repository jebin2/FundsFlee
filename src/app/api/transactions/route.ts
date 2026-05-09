import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appendTransaction, getTransactions } from "@/lib/sheets";
import { checkDuplicate } from "@/lib/ai/dedup";
import { apiError } from "@/lib/api-error";
import type { Transaction } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const transactions = await getTransactions(session.access_token, session.sheet_id);
    return NextResponse.json({ transactions });
  } catch (err) {
    return apiError("GET transactions error", err);
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transaction } = await req.json() as { transaction: Transaction };

  try {
    const tx: Transaction = {
      ...transaction,
      id: transaction.id || crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await appendTransaction(session.access_token, session.sheet_id, tx);

    const recent = await getTransactions(session.access_token, session.sheet_id, 100);
    const dedupResult = await checkDuplicate(tx, recent);

    return NextResponse.json({
      transaction: tx,
      duplicate: dedupResult.is_duplicate && dedupResult.confidence > 0.7 ? dedupResult : null,
    });
  } catch (err) {
    return apiError("POST transaction error", err);
  }
}
