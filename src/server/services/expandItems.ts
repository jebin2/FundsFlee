import { appendTransaction, updateTransactionField } from "@/lib/sheets";
import type { ParsedReceiptItem } from "@/types/parsed";
import type { Transaction } from "@/types";
import type { SheetSession } from "./types";

export function itemQuantity(qty: number, unit?: string | null): string | undefined {
  if (qty > 1) return `${qty}${unit ? ` ${unit}` : ""}`;
  return unit ? `1 ${unit}` : undefined;
}

export function unitPriceNote(qty: number, unit_price?: number | null): string | undefined {
  return unit_price != null && qty > 1 ? `₹${unit_price}/unit` : undefined;
}

type ItemExpansionBase = Pick<Transaction,
  "date" | "time" | "merchant" | "category" | "payment_method" | "source"
> & Partial<Pick<Transaction,
  "subcategory" | "notes" | "raw_input" | "receipt_url" | "receipt_id"
>>;

export async function expandItemsToRows(
  session: SheetSession,
  placeholderId: string,
  base: ItemExpansionBase,
  items: ParsedReceiptItem[],
  now: string,
  totalAmount?: number
): Promise<void> {
  for (const item of items) {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      ...base,
      amount: item.price,
      category: item.category || base.category,
      item_name: item.name,
      quantity: itemQuantity(item.qty, item.unit),
      notes: unitPriceNote(item.qty, item.unit_price) ?? base.notes,
      status: "done",
      created_at: now,
      updated_at: now,
    };
    await appendTransaction(session.accessToken, session.sheetId, tx);
  }

  if (totalAmount !== undefined) {
    const itemsTotal = items.reduce((s, i) => s + i.price, 0);
    const diff = parseFloat((totalAmount - itemsTotal).toFixed(2));
    if (diff > 0.01) {
      const adjustTx: Transaction = {
        id: crypto.randomUUID(),
        ...base,
        amount: diff,
        item_name: "Other Items",
        quantity: undefined,
        notes: undefined,
        status: "done",
        created_at: now,
        updated_at: now,
      };
      await appendTransaction(session.accessToken, session.sheetId, adjustTx);
    }
  }

  await updateTransactionField(session.accessToken, session.sheetId, placeholderId, {
    deleted: true,
    status: "done",
  });
}
