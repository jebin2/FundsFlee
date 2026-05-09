import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resetSheet } from "@/lib/sheets";
import { apiError } from "@/lib/api-error";

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await resetSheet(session.access_token, session.sheet_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError("Reset error", err);
  }
}
