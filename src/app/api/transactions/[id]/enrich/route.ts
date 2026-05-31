import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { prepareReceiptRetry, runEnrichTransactionJob, type TxContext } from "@/server/jobs/enrichTransactionJob";

const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ValidMimeType = typeof VALID_TYPES[number];

export const maxDuration = 480;

export const POST = withSession<{ id: string }>("POST transaction enrich", async (session, req, { id }) => {
  const formData = await req.formData();
  const text   = formData.get("text")   as string | null;
  const image  = formData.get("image")  as File   | null;
  const region = formData.get("region") as string | null ?? "";

  if (!text?.trim() && !image) {
    return NextResponse.json({ error: "text or image required" }, { status: 400 });
  }

  let txContext: TxContext | undefined;
  const raw = formData.get("txContext");
  if (typeof raw === "string") {
    try { txContext = JSON.parse(raw) as TxContext; } catch { /* ignore malformed */ }
  }

  const receiptId = formData.get("receiptId") as string | null ?? undefined;

  let imageBase64: string | undefined;
  let imageMimeType: ValidMimeType | undefined;
  if (image) {
    if (!VALID_TYPES.includes(image.type as ValidMimeType)) {
      return NextResponse.json({ error: "Only JPEG, PNG, WebP supported" }, { status: 400 });
    }
    imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    imageMimeType = image.type as ValidMimeType;
  }

  // For receipt retries, soft-delete old items and create the new placeholder *before*
  // returning so the client's refresh() sees the "processing" state immediately.
  let workTxId = id;
  if (receiptId) {
    try {
      workTxId = await prepareReceiptRetry(session, receiptId, txContext);
    } catch (err) {
      return NextResponse.json({ error: "Failed to prepare receipt retry" }, { status: 500 });
    }
  }

  runEnrichTransactionJob(session, {
    txId: workTxId,
    receiptId,
    text: text?.trim() || undefined,
    imageBase64,
    imageMimeType,
    region,
    txContext,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
});
