import { getGmailClient } from "@/lib/sheets/client";
import { log } from "@/lib/logger";
import {
  appendTransaction,
  getProcessedEmailIds,
  recordParsedEmail,
  setMetaValue,
} from "@/lib/sheets";
import { parseEmailTransaction, extractEmailText } from "@/lib/ai/parse-email";
import { todayISO } from "@/lib/date/iso";
import type { SheetSession } from "@/server/services/types";
import type { Transaction } from "@/types";
import { readEmailImportConfig } from "@/server/email-import/emailImportConfig";
import { buildGmailQuery } from "@/server/email-import/gmailQuery";
import { extractPayloadText } from "@/server/email-import/mimeTextExtractor";
import { deduplicateNewTransactions } from "@/server/email-import/postImportDuplicateCheck";

export type { EmailImportConfig } from "@/server/email-import/emailImportConfig";

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

  if (config.runningAt) {
    const ageMs = Date.now() - new Date(config.runningAt).getTime();
    if (ageMs < 5 * 60 * 1000) {
      log.warn("email", "already running — skipping");
      return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    }
  }

  await setMetaValue(session.accessToken, session.sheetId, "email_import_running_at", new Date().toISOString()).catch(() => {});

  try {
    const tag = manual ? "manual" : "auto";
    log.info("email", `started (${tag})`, { filters: config.fromContains.join(","), daysBack: config.daysBack });

    const gmail = getGmailClient(session.accessToken);
    const query = buildGmailQuery(config.fromContains, config.daysBack, manual ? undefined : config.lastRun);
    log.info("email", `gmail query: ${query}`);

    let messageIds: string[] = [];
    try {
      const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 100 });
      messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    } catch (err) {
      log.error("email", "gmail list failed", err);
      return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    }

    log.info("email", `found ${messageIds.length} emails`);

    const processedIds = await getProcessedEmailIds(session.accessToken, session.sheetId).catch(() => new Set<string>());
    const result: EmailImportResult = { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    const newTxIds: string[] = [];
    const today = todayISO();

    for (const msgId of messageIds) {
      result.scanned++;

      if (processedIds.has(msgId)) { result.skipped++; continue; }

      let from = "";
      let subject = "";
      let bodyText = "";

      try {
        const msgRes = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
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

      const { transaction, skipReason } = await parseEmailTransaction(
        bodyText, from, subject, config.region, today
      );

      if (!transaction) {
        log.info("email", `skipped "${subject}"`, { reason: skipReason });
        await recordParsedEmail(session.accessToken, session.sheetId, {
          emailId: msgId, from, subject,
          parsedAt: new Date().toISOString(),
          status: skipReason === "parse_error" ? "failed" : "skipped",
          txIds: [],
        }).catch(() => {});
        skipReason === "parse_error" ? result.failed++ : result.skipped++;
        continue;
      }

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

      log.info("email", `imported ₹${tx.amount} @ ${tx.merchant}`, { category: tx.category, subject });
      result.imported++;
    }

    await deduplicateNewTransactions(session, newTxIds).catch(() => {});

    await Promise.all([
      setMetaValue(session.accessToken, session.sheetId, "email_import_last_run", new Date().toISOString()),
      setMetaValue(session.accessToken, session.sheetId, "email_import_tx_count", String(config.txCount + result.imported)),
    ]).catch(() => {});

    log.info("email", "done", { scanned: result.scanned, imported: result.imported, skipped: result.skipped, failed: result.failed });
    return result;
  } finally {
    await setMetaValue(session.accessToken, session.sheetId, "email_import_running_at", "").catch(() => {});
  }
}
