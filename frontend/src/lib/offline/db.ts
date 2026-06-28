import Dexie, { type Table } from "dexie";
import type { Transaction } from "@/types";

export interface QueuedOp {
  id?: number;
  method: string;
  url: string;
  body: string;       // JSON-stringified
  created_at: number; // epoch ms
}

export interface ConflictedOp {
  id?: number;
  method: string;
  url: string;
  body: string;
  statusCode: number;
  failed_at: number;  // epoch ms
}

class OfflineDB extends Dexie {
  transactions!: Table<Transaction, string>;
  queue!: Table<QueuedOp, number>;
  conflicts!: Table<ConflictedOp, number>;

  constructor() {
    super("FundsFleeOffline");
    this.version(1).stores({
      transactions: "id, date",
      queue: "++id, created_at",
    });
    this.version(2).stores({
      transactions: "id, date",
      queue: "++id, created_at",
      conflicts: "++id, failed_at",
    });
  }
}

export const offlineDb = new OfflineDB();
