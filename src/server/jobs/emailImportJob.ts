import { getGmailClient } from "@/lib/sheets/client";
import {
  appendTransaction,
  getProcessedEmailIds,
  recordParsedEmail,
  getMetaValues,
  setMetaValue,
  getTransactions,
} from "@/lib/sheets";
import { safeJsonParse } from "@/lib/safeJson";
import { findDuplicates } from "@/lib/ai/dedup";
import { updateTransactionField } from "@/lib/sheets";
import { parseEmailTransaction, extractEmailText } from "@/lib/ai/parse-email";
import { todayISO } from "@/lib/date/iso";
import type { SheetSession } from "@/server/services/types";
import type { Transaction } from "@/types";

// ── Config ────────────────────────────────────────────────────────────────────

export interface EmailImportConfig {
  fromContains: string[];  // non-empty = enabled; empty = disabled
  daysBack: number;
  region: string;
  lastRun?: string;
  txCount: number;
  runningAt?: string;  // set while job is in flight, cleared on finish
}

export async function readEmailImportConfig(session: SheetSession): Promise<EmailImportConfig> {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  return {
    fromContains: safeJsonParse<string[]>(meta.email_import_from_contains ?? null, []),
    daysBack: meta.email_import_days_back ? parseInt(meta.email_import_days_back) : 7,
    region: meta.region ?? "",
    lastRun: meta.email_import_last_run || undefined,
    txCount: parseInt(meta.email_import_tx_count ?? "0") || 0,
    runningAt: meta.email_import_running_at || undefined,
  };
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

function buildGmailQuery(fromContains: string[], daysBack: number, lastRun?: string): string {
  // Build from: filter — matches any sender containing one of the substrings
  const fromFilter = fromContains.map((f) => `from:${f}`).join(" OR ");
  const fromPart = fromContains.length === 1 ? `from:${fromContains[0]}` : `{${fromFilter}}`;

  // Use last_run timestamp if available, else fall back to newer_than:Nd
  const datePart = lastRun
    ? `after:${Math.floor(new Date(lastRun).getTime() / 1000)}`
    : `newer_than:${daysBack}d`;

  return `${fromPart} ${datePart}`;
}

// Decode base64url-encoded Gmail body data
function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

// Recursively find the best text part in a MIME message
function extractPayloadText(payload: {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
}): { text: string; mimeType: string } {
  const mime = payload.mimeType ?? "";

  // Prefer text/plain
  if (mime === "text/plain" && payload.body?.data) {
    return { text: decodeBase64(payload.body.data), mimeType: "text/plain" };
  }

  // Recurse into multipart
  if (mime.startsWith("multipart") && Array.isArray(payload.parts)) {
    // Try plain first, then html
    for (const targetMime of ["text/plain", "text/html"]) {
      for (const part of payload.parts) {
        const p = part as typeof payload;
        if (p.mimeType === targetMime && p.body?.data) {
          return { text: decodeBase64(p.body.data), mimeType: targetMime };
        }
        // Nested multipart
        if (p.mimeType?.startsWith("multipart")) {
          const result = extractPayloadText(p);
          if (result.text) return result;
        }
      }
    }
  }

  // Fall back to html
  if (mime === "text/html" && payload.body?.data) {
    return { text: decodeBase64(payload.body.data), mimeType: "text/html" };
  }

  return { text: "", mimeType: "text/plain" };
}

// ── Duplicate detection (page-wise, token-safe) ───────────────────────────────

async function deduplicateNewTransactions(
  session: SheetSession,
  newTxIds: string[]
): Promise<void> {
  if (newTxIds.length === 0) return;

  // Fetch page 1 (most recent 200 rows) — newly imported txs are at the end of the sheet
  const { transactions: recentTxs } = await getTransactions(session.accessToken, session.sheetId, 1, 200);

  if (recentTxs.length < 2) return;

  const groups = await findDuplicates(recentTxs).catch(() => []);

  await Promise.all(
    groups.flatMap((group) =>
      group.duplicate_ids.map((dupId) =>
        updateTransactionField(session.accessToken, session.sheetId, dupId, {
          is_duplicate: true,
          duplicate_ref: group.original_id,
        }).catch(() => {})
      )
    )
  );
}

// ── Main job ──────────────────────────────────────────────────────────────────

export interface EmailImportResult {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
}

export async function runEmailImportJob(session: SheetSession, { manual = false } = {}): Promise<EmailImportResult> {
  const config = await readEmailImportConfig(session);

  if (config.fromContains.length === 0) {
    return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
  }

  // Concurrent-run guard: if another job set running_at within the last 5 minutes,
  // skip — it's still in flight. If it's older than 5 min the previous process likely
  // crashed (server restart) and didn't clear the flag, so we proceed and overwrite.
  if (config.runningAt) {
    const ageMs = Date.now() - new Date(config.runningAt).getTime();
    if (ageMs < 5 * 60 * 1000) {
      return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    }
  }

  // Mark job as running in the sheet — visible to any window/device polling status
  await setMetaValue(session.accessToken, session.sheetId, "email_import_running_at", new Date().toISOString()).catch(() => {});

  try {
  const gmail = getGmailClient(session.accessToken);
  // Manual fetch always uses daysBack so the user gets the lookback they configured.
  // Auto daily trigger uses lastRun so only new emails are fetched.
  const query = buildGmailQuery(config.fromContains, config.daysBack, manual ? undefined : config.lastRun);

  // Fetch message IDs matching the query (max 100 per run)
  let messageIds: string[] = [];
  try {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
    });
    messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  } catch {
    return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
  }

  // Load all previously-processed email IDs once — avoids N+1 Sheets API calls
  const processedIds = await getProcessedEmailIds(session.accessToken, session.sheetId).catch(() => new Set<string>());

  const result: EmailImportResult = { scanned: 0, imported: 0, skipped: 0, failed: 0 };
  const newTxIds: string[] = [];
  const today = todayISO();

  for (const msgId of messageIds) {
    result.scanned++;

    // Already processed → skip (in-memory check, zero extra API calls)
    if (processedIds.has(msgId)) { result.skipped++; continue; }

    // Fetch full message
    let from = "";
    let subject = "";
    let bodyText = "";

    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msgId,
        format: "full",
      });

      const headers = msgRes.data.payload?.headers ?? [];
      from    = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";

      const { text, mimeType } = extractPayloadText(msgRes.data.payload as Parameters<typeof extractPayloadText>[0]);
      bodyText = extractEmailText(text, mimeType);
    } catch {
      await recordParsedEmail(session.accessToken, session.sheetId, {
        emailId: msgId, from, subject,
        parsedAt: new Date().toISOString(), status: "failed", txIds: [],
      }).catch(() => {});
      result.failed++;
      continue;
    }

    // AI parse + validation
    const { transaction, skipReason } = await parseEmailTransaction(
      bodyText, from, subject, config.region, today
    );

    if (!transaction) {
      await recordParsedEmail(session.accessToken, session.sheetId, {
        emailId: msgId, from, subject,
        parsedAt: new Date().toISOString(),
        status: skipReason === "parse_error" ? "failed" : "skipped",
        txIds: [],
      }).catch(() => {});
      skipReason === "parse_error" ? result.failed++ : result.skipped++;
      continue;
    }

    // Write transaction
    const now = new Date().toISOString();
    const tx: Transaction = {
      id: crypto.randomUUID(),
      date: transaction.date,
      time: transaction.time,
      amount: transaction.amount,
      merchant: transaction.merchant,
      category: transaction.category,
      item_name: transaction.item_name,
      payment_method: transaction.payment_method,
      notes: transaction.notes,
      source: "email",
      raw_input: `${subject} | ${from}`.slice(0, 500),
      created_at: now,
      updated_at: now,
      status: "done",
    };

    await appendTransaction(session.accessToken, session.sheetId, tx);
    newTxIds.push(tx.id);

    await recordParsedEmail(session.accessToken, session.sheetId, {
      emailId: msgId, from, subject,
      parsedAt: now, status: "parsed", txIds: [tx.id],
    }).catch(() => {});

    result.imported++;
  }

  // Duplicate detection against recent transactions
  await deduplicateNewTransactions(session, newTxIds).catch(() => {});

  // Update last_run and cumulative count
  await Promise.all([
    setMetaValue(session.accessToken, session.sheetId, "email_import_last_run", new Date().toISOString()),
    setMetaValue(session.accessToken, session.sheetId, "email_import_tx_count", String(config.txCount + result.imported)),
  ]).catch(() => {});

  return result;
  } finally {
    // Always clear the running marker — whether job succeeded, failed, or threw
    await setMetaValue(session.accessToken, session.sheetId, "email_import_running_at", "").catch(() => {});
  }
}
