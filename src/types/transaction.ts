export type TransactionStatus = "queued" | "processing" | "done" | "failed" | "merging" | "merge_failed";
export type PaymentMethod = "Cash" | "UPI" | "Card" | "NetBanking" | "Other";
export type TransactionSource = "manual" | "sms" | "email" | "receipt" | "shortcut" | "merge" | "import";
export type RecurrencePeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface Transaction {
  id: string;
  date: string;
  time: string;
  amount: number;
  original_amount?: number;
  original_currency?: string;
  merchant: string;
  category: string;
  subcategory?: string;
  item_name?: string;       // col J — specific item name
  payment_method: PaymentMethod;
  tags?: string[];
  notes?: string;
  source: TransactionSource;
  raw_input?: string;
  location?: string;
  is_duplicate?: boolean;
  duplicate_ref?: string;
  created_at: string;
  updated_at: string;
  status?: TransactionStatus;
  receipt_url?: string;     // col V — Google Drive link to original image
  receipt_id?: string;      // col W — groups all items from the same scanned receipt
  quantity?: string;        // col X — e.g. "500g", "1kg", "2 pcs"
  deleted?: boolean;        // col Y — soft delete flag
  recurrence?: RecurrencePeriod; // col Z — recurring transaction period
}

export interface QueueItem {
  id?: number;
  type: "CREATE" | "UPDATE" | "DELETE";
  payload: Partial<Transaction>;
  created_at: string;
  retries: number;
}

export interface MetaEntry {
  key: string;
  value: string;
}
