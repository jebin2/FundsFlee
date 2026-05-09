import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appendTransaction, getTransactions } from "@/lib/sheets";
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
    const now = new Date().toISOString();
    const tx: Transaction = {
      ...transaction,
      id: transaction.id || crypto.randomUUID(),
      // Preserve client timestamps for offline-created transactions
      created_at: transaction.created_at || now,
      updated_at: now,
    };

    await appendTransaction(session.access_token, session.sheet_id, tx);
    return NextResponse.json({ transaction: tx });
  } catch (err) {
    return apiError("POST transaction error", err);
  }
}
