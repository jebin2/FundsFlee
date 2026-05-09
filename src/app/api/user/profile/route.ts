import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMetaValues, setMetaValue } from "@/lib/sheets";

export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const meta = await getMetaValues(session.access_token, session.sheet_id);
    return NextResponse.json({
      name: meta.name ?? session.user?.name ?? "",
      region: meta.region ?? "",
      lifestyle_tags: meta.lifestyle_tags ? JSON.parse(meta.lifestyle_tags) : [],
      monthly_income: meta.monthly_income ? parseFloat(meta.monthly_income) : null,
      shortcut_token: meta.shortcut_token ?? "",
      shortcut_last_used: meta.shortcut_last_used ?? "",
      sheet_url: meta.sheet_url ?? "",
    });
  } catch (err) {
    console.error("GET profile error:", err);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fields = await req.json() as Record<string, string>;

  try {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        const stored = typeof value === "object" ? JSON.stringify(value) : String(value);
        await setMetaValue(session.access_token, session.sheet_id, key, stored);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT profile error:", err);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}
