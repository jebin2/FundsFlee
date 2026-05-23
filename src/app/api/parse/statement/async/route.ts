import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { createStatementImportRequest } from "@/server/use-cases/createStatementImportRequest";

export const maxDuration = 60;

// POST /api/parse/statement/async  (multipart form: file=PDF)
export const POST = withSession("POST parse/statement/async", async (session, req: NextRequest) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.type !== "application/pdf")
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024)
    return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { txId } = await createStatementImportRequest(session, buffer);
  return NextResponse.json({ ok: true, txId });
});
