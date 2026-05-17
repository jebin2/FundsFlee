import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  getTransactionById,
  updateTransactionField,
  appendTransaction,
  downloadReceiptFromDrive,
} from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { log } from "@/lib/logger";
import type { SheetSession } from "@/server/services/types";
import type { Transaction } from "@/types";

const SYSTEM_PROMPT = `You are a bank statement parser for an Indian spending tracker.
Extract all debit transactions from the provided bank statement PDF.

Respond with valid JSON only:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": number,
      "merchant": string,
      "category": string (Food & Dining|Transport|Shopping|Entertainment|Health|Bills & Utilities|Education|Personal Care|Gifts & Donations|Others),
      "payment_method": "UPI"|"Card"|"NetBanking"|"Cash"|"Other",
      "notes": string or null
    }
  ]
}

Rules:
- Only include debits (money out), not credits
- Clean merchant names (e.g. "UPI/SWIGGY" → "Swiggy")
- Infer category from merchant when possible`;

function receiptFileId(url: string): string | null {
  return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

export async function runStatementParseJob(
  session: SheetSession,
  placeholderId: string
): Promise<void> {
  log.info("statement-parse", "started", { placeholderId });
  await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "processing" });

  try {
    const placeholder = await getTransactionById(session.accessToken, session.sheetId, placeholderId);
    if (!placeholder?.receipt_url) {
      await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "failed" });
      log.error("statement-parse", "no receipt_url on placeholder", { placeholderId });
      return;
    }

    const fileId = receiptFileId(placeholder.receipt_url);
    if (!fileId) {
      await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "failed" });
      return;
    }

    const { buffer } = await downloadReceiptFromDrive(session.accessToken, fileId);
    const base64 = buffer.toString("base64");

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: process.env.AI_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as ContentBlockParam,
          { type: "text", text: `Today is ${todayISO()}. Extract all debit transactions.` } as ContentBlockParam,
        ],
      }],
    });

    const block = msg.content[0];
    if (block.type !== "text") throw new Error("Unexpected AI response type");

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse AI response");

    const { transactions: rows } = JSON.parse(jsonMatch[0]) as {
      transactions: { date: string; amount: number; merchant: string; category: string; payment_method: string; notes: string | null }[]
    };

    log.info("statement-parse", `extracted ${rows.length} transactions`, { placeholderId });

    const now = new Date().toISOString();
    for (const row of rows) {
      const tx: Transaction = {
        id:             crypto.randomUUID(),
        date:           row.date,
        time:           "00:00",
        amount:         row.amount,
        merchant:       row.merchant,
        category:       row.category,
        payment_method: (row.payment_method as Transaction["payment_method"]) || "Other",
        notes:          row.notes ?? undefined,
        source:         "import",
        receipt_id:     placeholderId,
        status:         "done",
        created_at:     now,
        updated_at:     now,
      };
      await appendTransaction(session.accessToken, session.sheetId, tx);
    }

    // Mark placeholder done (don't delete — keeps it as an audit entry)
    await updateTransactionField(session.accessToken, session.sheetId, placeholderId, {
      deleted: true,
      status:  "done",
    });

    log.info("statement-parse", "done", { placeholderId, count: rows.length });
  } catch (err) {
    log.error("statement-parse", "failed", { placeholderId, err });
    await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "failed" }).catch(() => {});
    throw err;
  }
}
