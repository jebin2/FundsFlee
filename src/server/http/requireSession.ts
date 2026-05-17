import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { SheetSession } from "@/server/services/types";

type SessionResult =
  | { ok: true; session: SheetSession }
  | { ok: false; response: NextResponse };

export async function requireSession(): Promise<SessionResult> {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return {
    ok: true,
    session: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      sheetId: session.sheet_id,
      userEmail: session.user?.email ?? undefined,
    },
  };
}
