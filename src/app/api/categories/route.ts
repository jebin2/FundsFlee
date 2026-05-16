import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getCategories, appendCategory } from "@/lib/sheets";

export const GET = withSession("GET categories", async (session) => {
  const categories = await getCategories(session.accessToken, session.sheetId);
  return NextResponse.json({ categories });
});

export const POST = withSession("POST category", async (session, req) => {
  const cat = await req.json() as { id: string; name: string; color: string; icon: string; created_at: string };
  await appendCategory(session.accessToken, session.sheetId, cat);
  return NextResponse.json({ ok: true });
});
