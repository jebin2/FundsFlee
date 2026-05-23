export function buildGmailQuery(fromContains: string[], daysBack: number, lastRun?: string): string {
  const fromFilter = fromContains.map((f) => `from:${f}`).join(" OR ");
  const fromPart = fromContains.length === 1 ? `from:${fromContains[0]}` : `{${fromFilter}}`;
  const datePart = lastRun
    ? `after:${Math.floor(new Date(lastRun).getTime() / 1000)}`
    : `newer_than:${daysBack}d`;
  return `${fromPart} ${datePart}`;
}
