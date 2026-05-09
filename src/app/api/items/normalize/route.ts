import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestItemNormalization } from "@/server/services/itemNormalizationService";

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    await requestItemNormalization({ accessToken: session.access_token, sheetId: session.sheet_id })
  );
}
