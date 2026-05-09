import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resetSheet } from "@/lib/sheets";

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await resetSheet(session.access_token, session.sheet_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Reset error:", err);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
