import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "cron-session.json");

export interface CronSession {
  refreshToken: string;
  sheetId: string;
  userEmail: string;
  savedAt: string;
}

export function saveCronSession(session: CronSession): void {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function loadCronSession(): CronSession | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf-8")) as CronSession;
  } catch {
    return null;
  }
}

export function cronSessionExists(): boolean {
  return fs.existsSync(FILE);
}
