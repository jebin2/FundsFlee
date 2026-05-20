// Server-side logger — output goes to pm2 logs / stdout.
// Format: HH:MM:SS LEVEL [tag] message  key=value ...

type Level = "INFO" | "WARN" | "ERROR";

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

function fmt(level: Level, tag: string, msg: string, data?: Record<string, unknown>): string {
  const base = `${ts()} ${level.padEnd(5)} [${tag}] ${msg}`;
  if (!data || Object.keys(data).length === 0) return base;
  const pairs = Object.entries(data)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${base}  ${pairs}`;
}

export const log = {
  info(tag: string, msg: string, data?: Record<string, unknown>) {
    console.log(fmt("INFO", tag, msg, data));
  },
  warn(tag: string, msg: string, data?: Record<string, unknown>) {
    console.warn(fmt("WARN", tag, msg, data));
  },
  error(tag: string, msg: string, err?: unknown, data?: Record<string, unknown>) {
    const errStr = err instanceof Error
      ? err.message
      : err !== undefined ? String(err) : undefined;
    const combined = errStr ? { ...data, err: errStr } : data;
    console.error(fmt("ERROR", tag, msg, combined));
    if (err instanceof Error && err.stack) {
      const frames = err.stack.split("\n").slice(1).join("\n");
      if (frames) console.error(frames);
    }
  },
};
