import { google } from "googleapis";
import { log } from "@/lib/logger";

export function getAuth(accessToken: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function getSheetsClient(accessToken: string) {
  return google.sheets({ version: "v4", auth: getAuth(accessToken) });
}

export function getDriveClient(accessToken: string) {
  return google.drive({ version: "v3", auth: getAuth(accessToken) });
}

export function getGmailClient(accessToken: string) {
  return google.gmail({ version: "v1", auth: getAuth(accessToken) });
}

// Retry wrapper for Sheets API calls — handles 429 (rate limit) and transient 5xx.
// Quota (429) waits 65s to let the per-minute window reset; 5xx uses exponential backoff.
export async function withSheetsRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { code?: number | string; status?: number | string; response?: { status?: number } };
      const status = Number(e.code ?? e.status ?? e.response?.status ?? 0);
      const isQuota = status === 429;
      const isTransient = status === 500 || status === 503;
      if ((isQuota || isTransient) && attempt < maxRetries) {
        const delay = isQuota ? 65_000 : 1000 * Math.pow(2, attempt);
        log.warn("sheets", `retry ${attempt + 1}/${maxRetries}`, { status, delayMs: delay });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}
