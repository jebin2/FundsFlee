import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseTransactionText } from "@/lib/ai/parse-text";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { text, region } = await req.json();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  try {
    const today = new Date().toISOString().split("T")[0];
    const extracted = await parseTransactionText(text, region, today);
    return NextResponse.json({ extracted, confidence: extracted.confidence });
  } catch (err) {
    console.error("Parse text error:", err);
    return NextResponse.json({ error: "Failed to parse text" }, { status: 500 });
  }
}
