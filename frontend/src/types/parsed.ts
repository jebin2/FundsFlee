import type { PaymentMethod } from "./transaction";

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
  items?: ParsedReceiptItem[];
  notes?: string;
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

