import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateTransactionField } from "@/lib/sheets";
import { apiError } from "@/lib/api-error";
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
    return apiError("PUT transaction error", err);
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
    return apiError("PATCH transaction error", err);
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
    return apiError("DELETE transaction error", err);
  }
}
