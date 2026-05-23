import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { createTextParseRequest } from "@/server/use-cases/createTextParseRequest";

// POST /api/parse/text/async  Body: { text, region? }
export const POST = withSession("POST parse/text/async", async (session, req: NextRequest) => {
  const { text, region = "" } = await req.json() as { text: string; region?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const { txId } = await createTextParseRequest(session, text, region);
  return NextResponse.json({ ok: true, txId });
});
