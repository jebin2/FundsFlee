import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/server/http/requireSession";
import { getOrCreateReceiptsFolder, uploadReceiptToDrive, appendTransaction } from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { createQueuedReceiptTransaction } from "@/domain/transactions/factory";

function baseUrl(req: NextRequest) {
  const { protocol, host } = new URL(req.url);
  return `${protocol}//${host}`;
}

// Handles PWA share target (manifest share_target.action = /api/share).
// Browser POSTs here when the user shares content into FundsFlee from
// another app. Must return a redirect — browsers treat non-redirect
// responses from share targets as errors.
export async function POST(req: NextRequest) {
  const result = await requireSession();
  if (!result.ok) {
    return NextResponse.redirect(new URL("/?share=auth_required", req.url));
  }

  const formData = await req.formData();
  const text  = (formData.get("text")  as string | null) ?? "";
  const url   = (formData.get("url")   as string | null) ?? "";
  const image = formData.get("image")  as File | null;

  // Image/receipt shared (e.g. from camera roll or WhatsApp)
  if (image && image.size > 0) {
    try {
      const { accessToken, sheetId } = result.session;
      const mimeType = image.type || "image/jpeg";
      const buffer   = Buffer.from(await image.arrayBuffer());
      const txId     = crypto.randomUUID();
      const filename = `${todayISO()}_${txId.slice(0, 8)}.jpg`;

      const folderId  = await getOrCreateReceiptsFolder(accessToken, sheetId);
      const { viewUrl } = await uploadReceiptToDrive(accessToken, folderId, buffer, filename, mimeType);
      const tx = createQueuedReceiptTransaction(viewUrl, txId);
      await appendTransaction(accessToken, sheetId, tx);
    } catch {
      // Best-effort — still redirect to transactions
    }
    return NextResponse.redirect(new URL("/transactions?shared_receipt=1", baseUrl(req)));
  }

  // Text/URL shared (e.g. SMS, article text)
  const sharedText = text || url;
  if (sharedText) {
    const dest = `/capture?tab=paste&text=${encodeURIComponent(sharedText)}`;
    return NextResponse.redirect(new URL(dest, baseUrl(req)));
  }

  return NextResponse.redirect(new URL("/capture", baseUrl(req)));
}
