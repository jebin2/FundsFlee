export type TransactionStatus = "queued" | "processing" | "done" | "failed";

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
}

export type PaymentMethod = "Cash" | "UPI" | "Card" | "NetBanking" | "Other";
export type TransactionSource = "manual" | "sms" | "email" | "receipt" | "shortcut";

export interface Category {
  id: string;
  name: string;
  parent_id?: string;
  color: string;
  icon: string;
  is_default: boolean;
  created_at: string;
}

// Used by AI parse-text (single transaction from SMS/email)
export interface ParsedTransaction {
  merchant: string;
  amount: number;
  currency: string;
  date: string;
  time: string;
  category: string;
  subcategory?: string;
  item_name?: string;
  payment_method: PaymentMethod;
  confidence: number;
  uncertain_fields: string[];
}

// Used by AI parse-image (receipt → multiple items)
export interface ParsedReceiptItem {
  name: string;
  qty: number;
  unit?: string;
  price: number;           // total price for this line (qty × unit price)
  unit_price?: number;     // per-unit price if available
  category?: string;
}

export interface ParsedReceipt {
  merchant: string;
  date: string;
  time: string;
  payment_method: PaymentMethod;
  category: string;        // overall/default category
  confidence: number;
  uncertain_fields: string[];
  items: ParsedReceiptItem[];
}

export interface DuplicateResult {
  is_duplicate: boolean;
  confidence: number;
  duplicate_of_id?: string;
  reason?: string;
}

export interface AnalysisResult {
  period: string;
  period_type: "day" | "week" | "month" | "custom";
  total_spent: number;
  by_category: CategorySummary[];
  ai_insights: string[];
  optimization_tips: OptimizationTip[];
}

export interface CategorySummary {
  category: string;
  amount: number;
  percent: number;
  count: number;
}

export interface OptimizationTip {
  title: string;
  description: string;
  potential_saving: number;
  effort: "low" | "medium" | "high";
  quality_impact: "none" | "minimal" | "moderate";
}

export interface UserProfile {
  name: string;
  email: string;
  image?: string;
  region?: string;
  lifestyle_tags?: string[];
  monthly_income?: number;
  shortcut_token?: string;
  sheet_id?: string;
  sheet_url?: string;
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
