import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { deleteCategoryById } from "@/lib/sheets";

export const DELETE = withSession<{ id: string }>("DELETE category", async (session, _req, { id }) => {
  await deleteCategoryById(session.accessToken, session.sheetId, id);
  return NextResponse.json({ ok: true });
});
