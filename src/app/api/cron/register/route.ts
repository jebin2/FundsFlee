import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { saveCronSession } from "@/lib/cron/cronStore";

// Called silently on app load to persist credentials for the server-side cron.
// Safe to call on every load — writes are cheap and keep the token fresh.
export const POST = withSession("POST cron/register", async (session) => {
  if (!session.refreshToken) {
    return NextResponse.json({ ok: false, reason: "no refresh token in session" });
  }
  saveCronSession({
    refreshToken: session.refreshToken,
    sheetId:      session.sheetId,
    userEmail:    session.userEmail ?? "",
    savedAt:      new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
});
