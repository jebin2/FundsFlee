import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { processReceipt } from "@/server/services/receiptProcessingService";

export const maxDuration = 360;

export const POST = withSession("POST receipts process", async (session, req) => {
  const { txId, region } = await req.json();
  if (!txId) return NextResponse.json({ error: "txId required" }, { status: 400 });
  const receipt = await processReceipt(session, { txId, region });
  if ("error" in receipt) return NextResponse.json({ error: receipt.error }, { status: receipt.status });
  return NextResponse.json(receipt);
});
