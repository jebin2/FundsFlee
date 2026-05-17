import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { appendTransaction, setMetaValue } from "@/lib/sheets";
import { parseTransactionText } from "@/lib/ai/parse-text";
import type { Transaction } from "@/types";
import { todayISO } from "@/lib/date/iso";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "change-me");

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("token_refresh_failed");
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("token_refresh_failed");
  return data.access_token;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const token = auth.slice(7);
  let payload: { email: string; sheetId: string; region?: string; refreshToken?: string };

  try {
    const { payload: p } = await jwtVerify(token, SECRET);
    payload = p as typeof payload;
    if (!payload.email || !payload.sheetId) throw new Error("Invalid payload");
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { text, source = "shortcut" } = await req.json();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  if (!payload.refreshToken) {
    return NextResponse.json({ error: "Token is outdated — please reinstall the shortcut from the app." }, { status: 401 });
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(payload.refreshToken);
  } catch {
    return NextResponse.json({ error: "Could not authenticate — please reinstall the shortcut from the app." }, { status: 401 });
  }

  const parsed = await parseTransactionText(text, payload.region ?? "", todayISO());

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
  await setMetaValue(accessToken, payload.sheetId, "shortcut_last_used", new Date().toISOString());

  return NextResponse.json({ entry: tx });
}
