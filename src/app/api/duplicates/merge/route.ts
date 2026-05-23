import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { createMergeRequest } from "@/server/use-cases/createMergeRequest";

// POST /api/duplicates/merge  Body: { transactionIds: string[] }
export const POST = withSession("POST duplicates/merge", async (session, req: NextRequest) => {
  const { transactionIds } = await req.json() as { transactionIds: string[] };
  if (!transactionIds || transactionIds.length < 2)
    return NextResponse.json({ error: "Need at least 2 transaction IDs to merge" }, { status: 400 });
  const result = await createMergeRequest(session, transactionIds);
  return NextResponse.json({ ok: true, ...result });
});
