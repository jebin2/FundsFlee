import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getEmailImportStatus, saveEmailImportConfig } from "@/server/services/emailImportService";

export const GET = withSession("GET email config", async (session) => {
  const status = await getEmailImportStatus(session);
  return NextResponse.json(status);
});

export const PUT = withSession("PUT email config", async (session, req) => {
  const body = await req.json() as { fromContains?: string[]; daysBack?: number };
  await saveEmailImportConfig(session, body);
  return NextResponse.json({ ok: true });
});
