import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPendingSuggestions, resolvePendingSuggestion } from "@/server/services/itemSuggestionService";

// GET — return all actionable pending suggestions (skip same-value sentinels)
export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suggestions = await getPendingSuggestions({
    accessToken: session.access_token,
    sheetId: session.sheet_id,
  });
  return NextResponse.json({ suggestions });
}

// PATCH — accept or reject one field suggestion
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await resolvePendingSuggestion(
    { accessToken: session.access_token, sheetId: session.sheet_id },
    await req.json()
  );
  return NextResponse.json({ ok: true });
}
