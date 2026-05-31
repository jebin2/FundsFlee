import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getMetaValues, setMetaValue } from "@/lib/sheets";
import { auth } from "@/lib/auth";
import { safeJsonParse } from "@/lib/safeJson";

export const GET = withSession("GET profile", async (session) => {
  const { accessToken, sheetId } = session;
  const nextAuthSession = await auth();
  const meta = await getMetaValues(accessToken, sheetId);
  return NextResponse.json({
    name: meta.name ?? nextAuthSession?.user?.name ?? "",
    region: meta.region ?? "",
    lifestyle_tags: safeJsonParse<string[]>(meta.lifestyle_tags ?? null, []),
    monthly_income: meta.monthly_income ? parseFloat(meta.monthly_income) : null,
    shortcut_token: meta.shortcut_token ?? "",
    shortcut_last_used: meta.shortcut_last_used ?? "",
    sheet_url: meta.sheet_url ?? "",
    receipts_folder_id: meta.receipts_folder_id ?? "",
  });
});

export const PUT = withSession("PUT profile", async (session, req) => {
  const { accessToken, sheetId } = session;
  const fields = await req.json() as Record<string, string>;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      const stored = typeof value === "object" ? JSON.stringify(value) : String(value);
      await setMetaValue(accessToken, sheetId, key, stored);
    }
  }
  return NextResponse.json({ ok: true });
});
