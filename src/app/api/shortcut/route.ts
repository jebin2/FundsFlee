import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { appendTransaction, getTransactions, setMetaValue } from "@/lib/sheets";
import { parseTransactionText } from "@/lib/ai/parse-text";
import { checkDuplicate } from "@/lib/ai/dedup";
import type { Transaction } from "@/types";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "change-me");

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const token = auth.slice(7);
  let payload: { userId: string; sheetId: string; region?: string };

  try {
    const { payload: p } = await jwtVerify(token, SECRET);
    payload = p as typeof payload;
    if (!payload.userId || !payload.sheetId) throw new Error("Invalid payload");
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { text, source = "shortcut" } = await req.json();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const accessToken = process.env.SERVICE_ACCOUNT_TOKEN ?? "";
  if (!accessToken) {
    return NextResponse.json({ error: "Server not configured for shortcut auth" }, { status: 500 });
  }

  const today = new Date().toISOString().split("T")[0];
  const parsed = await parseTransactionText(text, payload.region, today);

  const tx: Transaction = {
    id: crypto.randomUUID(),
    date: parsed.date,
    time: parsed.time,
    amount: parsed.amount,
    merchant: parsed.merchant,
    category: parsed.category,
    subcategory: parsed.subcategory,
    item_name: parsed.item_name,
    payment_method: parsed.payment_method,
    source: source as Transaction["source"],
    raw_input: text,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await appendTransaction(accessToken, payload.sheetId, tx);

  const recent = await getTransactions(accessToken, payload.sheetId, 50);
  const dedupResult = await checkDuplicate(tx, recent);

  await setMetaValue(accessToken, payload.sheetId, "shortcut_last_used", new Date().toISOString());

  return NextResponse.json({ entry: tx, is_duplicate: dedupResult.is_duplicate });
}
