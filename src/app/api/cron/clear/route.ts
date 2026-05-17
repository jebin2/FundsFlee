import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { setMetaValue } from "@/lib/sheets";

// POST /api/cron/clear?job=email|dedup|all
// Clears stuck running-at flags left by a server restart.
// Defaults to clearing both when no job param is provided.
export const POST = withSession("POST cron/clear", async (session, req: NextRequest) => {
  const job = new URL(req.url).searchParams.get("job") ?? "all";

  const clears: Promise<void>[] = [];
  if (job === "email" || job === "all") {
    clears.push(setMetaValue(session.accessToken, session.sheetId, "email_import_running_at", ""));
  }
  if (job === "dedup" || job === "all") {
    clears.push(setMetaValue(session.accessToken, session.sheetId, "dedup_running_at", ""));
  }
  await Promise.all(clears);

  return NextResponse.json({ ok: true });
});
