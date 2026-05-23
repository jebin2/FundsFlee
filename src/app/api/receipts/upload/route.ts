import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { createReceiptUploadRequest } from "@/server/use-cases/createReceiptUploadRequest";

export const maxDuration = 60;

export const POST = withSession("POST receipts upload", async (session, req) => {
  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "image required" }, { status: 400 });

  const mimeType = image.type || "image/jpeg";
  const buffer = Buffer.from(await image.arrayBuffer());
  const result = await createReceiptUploadRequest(session, buffer, mimeType);
  return NextResponse.json(result);
});
