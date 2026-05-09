import Dexie, { type Table } from "dexie";
import type { Transaction } from "@/types";

export interface QueuedOp {
  id?: number;
  method: string;
  url: string;
  body: string;       // JSON-stringified
  created_at: number; // epoch ms
}

class OfflineDB extends Dexie {
  transactions!: Table<Transaction, string>;
  queue!: Table<QueuedOp, number>;

  constructor() {
    super("SpendingTrackerOffline");
    this.version(1).stores({
      transactions: "id, date",
      queue: "++id, created_at",
    });
  }
}

export const offlineDb = new OfflineDB();
