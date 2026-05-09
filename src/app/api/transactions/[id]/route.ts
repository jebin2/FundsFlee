import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateTransactionField } from "@/lib/sheets";
import type { Transaction } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { updates } = await req.json() as { updates: Partial<Transaction> };

  try {
    await updateTransactionField(session.access_token, session.sheet_id, id, updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT transaction error:", err);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const updates = await req.json() as Partial<Transaction>;

  try {
    await updateTransactionField(session.access_token, session.sheet_id, id, updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH transaction error:", err);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await updateTransactionField(session.access_token, session.sheet_id, id, { deleted: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE transaction error:", err);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
