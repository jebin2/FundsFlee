import type { Transaction } from "@/types";
import { jsonPost, jsonPut, jsonPatch } from "./http";

export const TRANSACTIONS_URL = "/api/transactions" as const;
export const transactionUrl = (id: string) => `/api/transactions/${id}` as const;

type TransactionPayload = Omit<Transaction, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export const transactionsApi = {
  list: () => fetch(TRANSACTIONS_URL),

  create: (tx: TransactionPayload) =>
    jsonPost(TRANSACTIONS_URL, { transaction: tx }),

  update: (id: string, updates: Partial<Transaction>) =>
    jsonPut(transactionUrl(id), { updates }),

  patch: (id: string, updates: Partial<Transaction>) =>
    jsonPatch(transactionUrl(id), updates),

  delete: (id: string) => fetch(transactionUrl(id), { method: "DELETE" }),
};
