import Dexie, { type Table } from "dexie";
import type { Transaction, Category, QueueItem, MetaEntry, AnalysisResult } from "@/types";

export class SpendingTrackerDB extends Dexie {
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  queue!: Table<QueueItem, number>;
  analysis_cache!: Table<{ id: string; period: string; result: AnalysisResult; cached_at: string }, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("SpendingTrackerDB");
    this.version(1).stores({
      transactions: "id, date, merchant, category, source, is_duplicate, created_at",
      categories: "id, name, parent_id, is_default",
      queue: "++id, type, created_at",
      analysis_cache: "id, period, cached_at",
      meta: "key",
    });
  }
}

export const db = new SpendingTrackerDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const entry = await db.meta.get(key);
  return entry?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function enqueueWrite(item: Omit<QueueItem, "id">): Promise<void> {
  await db.queue.add(item);
}

export async function flushQueue(
  handler: (item: QueueItem) => Promise<boolean>
): Promise<void> {
  const items = await db.queue.orderBy("created_at").toArray();
  for (const item of items) {
    const success = await handler(item);
    if (success) {
      await db.queue.delete(item.id!);
    } else {
      await db.queue.update(item.id!, { retries: item.retries + 1 });
    }
  }
}
