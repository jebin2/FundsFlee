import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { SignJWT } from "jose";
import { getMetaValues, setMetaValue } from "@/lib/sheets";
import { apiError } from "@/lib/api-error";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "change-me");

async function generateToken(email: string, sheetId: string): Promise<string> {
  return new SignJWT({ email, sheetId, purpose: "shortcut" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(SECRET);
}

export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id || !session.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const meta = await getMetaValues(session.access_token, session.sheet_id);
    if (meta.shortcut_token) {
      return NextResponse.json({ token: meta.shortcut_token });
    }

    const token = await generateToken(session.user.email, session.sheet_id);
    await setMetaValue(session.access_token, session.sheet_id, "shortcut_token", token);
    return NextResponse.json({ token });
  } catch (err) {
    return apiError("GET token error", err);
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id || !session.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await generateToken(session.user.email, session.sheet_id);
    await setMetaValue(session.access_token, session.sheet_id, "shortcut_token", token);
    return NextResponse.json({ token });
  } catch (err) {
    return apiError("POST token error", err);
  }
}
