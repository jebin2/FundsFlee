import { generateWithImage } from "./client";
import type { ParsedReceipt } from "@/types";

const SYSTEM_PROMPT = `You are a receipt parser for an Indian spending tracker. Extract all line items from receipt images.

Always respond with valid JSON matching this schema exactly:
{
  "merchant": string,
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "payment_method": one of: Cash, UPI, Card, NetBanking, Other,
  "category": string (one of: Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others),
  "confidence": number 0-1,
  "uncertain_fields": array of field names you couldn't read clearly,
  "items": [
    {
      "name": string (item name as printed),
      "qty": number (quantity purchased),
      "unit": string or null (kg, g, L, ml, pcs, etc.),
      "price": number (total price for this line = qty × unit_price),
      "unit_price": number or null (price per single unit if calculable),
      "category": string or null (item-specific category if different from overall)
    }
  ]
}

Rules:
- Extract EVERY line item visible on the receipt
- Use the line total for price (not unit price, unless only one unit)
- Compute unit_price when qty > 1: unit_price = price / qty
- If a product weight is in the name (e.g. "Tata Salt 1kg"), include it in the name
- If receipt is blurry, extract what you can and list uncertain_fields
- The items array must never be empty — if only one item, still return it as array with one element`;

export async function parseReceiptImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  userRegion?: string,
  todayDate?: string
): Promise<ParsedReceipt> {
  const userContext = [
    userRegion ? `User is in ${userRegion}.` : "",
    todayDate ? `Today's date is ${todayDate}.` : `Today's date is ${new Date().toISOString().split("T")[0]}.`,
  ].filter(Boolean).join(" ");

  const raw = await generateWithImage(
    imageBase64,
    mediaType,
    `${userContext}\n\nParse this receipt and extract every line item.`,
    SYSTEM_PROMPT,
    2048
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]) as ParsedReceipt;
}
