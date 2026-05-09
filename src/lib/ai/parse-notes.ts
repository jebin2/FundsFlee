import { generateText } from "./client";

export interface NotesExtractions {
  item_name?: string;   // more specific name found in notes
  quantity?: string;    // e.g. "2 packets", "500g", "1kg"
  merchant?: string;    // shop/brand name found in notes
}

export async function extractFromNotes(
  entries: { tx_id: string; item_name?: string; notes: string; quantity?: string; merchant?: string }[]
): Promise<Record<string, NotesExtractions>> {
  if (entries.length === 0) return {};

  const raw = await generateText(
    `Extract structured fields from the notes of these transactions. Notes are free-text written by a user about a purchase.

Transactions:
${entries.map((e, i) =>
  `${i + 1}. id="${e.tx_id}" item="${e.item_name || ""}" notes="${e.notes}" existing_qty="${e.quantity || ""}" existing_merchant="${e.merchant || ""}"`
).join("\n")}

For each transaction, extract from the notes ONLY if not already set in existing fields:
- item_name: more specific product name (e.g. "full fat milk" → "Full Fat Milk", only if different from current)
- quantity: amount purchased (e.g. "2 packets", "500g", "1 litre")
- merchant: shop or brand name (e.g. "from Nandini", "at Big Bazaar")

Rules:
- Only suggest a field if you find it clearly in the notes
- Do NOT suggest if the existing value already covers it
- Return empty object {} for a tx_id if nothing useful is found
- merchant should be a proper noun (shop/brand), not a description

Respond with JSON only:
{
  "{tx_id}": {
    "item_name": "..." or omit,
    "quantity": "..." or omit,
    "merchant": "..." or omit
  },
  ...
}`,
    "",
    1024
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, NotesExtractions>;
  } catch {
    return {};
  }
}
