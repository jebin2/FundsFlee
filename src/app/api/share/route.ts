import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/server/http/requireSession";
import { createReceiptUploadRequest } from "@/server/use-cases/createReceiptUploadRequest";

function baseUrl(req: NextRequest) {
  const { protocol, host } = new URL(req.url);
  return `${protocol}//${host}`;
}

// Handles PWA share target (manifest share_target.action = /api/share).
// Must return a redirect — browsers treat non-redirect responses from share targets as errors.
export async function POST(req: NextRequest) {
  const result = await requireSession();
  if (!result.ok) return NextResponse.redirect(new URL("/?share=auth_required", req.url));

  const formData = await req.formData();
  const text  = (formData.get("text")  as string | null) ?? "";
  const url   = (formData.get("url")   as string | null) ?? "";
  const image = formData.get("image")  as File | null;

  if (image && image.size > 0) {
    try {
      const buffer = Buffer.from(await image.arrayBuffer());
      await createReceiptUploadRequest(result.session, buffer, image.type || "image/jpeg");
    } catch {
      // Best-effort — still redirect to transactions
    }
    return NextResponse.redirect(new URL("/transactions?shared_receipt=1", baseUrl(req)));
  }

  const sharedText = text || url;
  if (sharedText)
    return NextResponse.redirect(new URL(`/capture?tab=paste&text=${encodeURIComponent(sharedText)}`, baseUrl(req)));

  return NextResponse.redirect(new URL("/capture", baseUrl(req)));
}
