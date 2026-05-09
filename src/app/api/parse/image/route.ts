import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseReceiptImage } from "@/lib/ai/parse-image";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  const region = formData.get("region") as string | null;

  if (!image) return NextResponse.json({ error: "image is required" }, { status: 400 });

  const validTypes = ["image/jpeg", "image/png", "image/webp"] as const;
  const mediaType = image.type as typeof validTypes[number];
  if (!validTypes.includes(mediaType)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP supported" }, { status: 400 });
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const today = new Date().toISOString().split("T")[0];

  try {
    const extracted = await parseReceiptImage(base64, mediaType, region ?? undefined, today);
    return NextResponse.json({ extracted, confidence: extracted.confidence });
  } catch (err) {
    console.error("Parse image error:", err);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
