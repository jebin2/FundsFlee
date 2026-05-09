import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Sheet is already initialized during sign-in (auth.ts jwt callback).
// This endpoint just tells the client whether this is a new user.
export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // sheet_id being present means the sheet exists (set during JWT callback at sign-in).
  // We can't know isNew here anymore since init happens in the JWT callback.
  // The dashboard will use this to decide if onboarding is needed.
  return NextResponse.json({ isNew: false });
}
