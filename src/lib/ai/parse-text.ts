import { generateText } from "./client";
import type { ParsedTransaction } from "@/types";

const SYSTEM_PROMPT = `You are a transaction parser for an Indian spending tracker. Extract spending details from SMS or email text.

Always respond with valid JSON matching this schema exactly:
{
  "merchant": string,
  "amount": number (in INR),
  "currency": "INR",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "category": string (one of: Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others),
  "subcategory": string or null,
  "items": array of {name, qty, price} or [],
  "payment_method": one of: Cash, UPI, Card, NetBanking, Other,
  "confidence": number 0-1,
  "uncertain_fields": array of field names that are uncertain
}

Rules:
- If date is missing, use today's date
- If time is missing, use "00:00"
- Extract all line items you can see (grocery receipts, order details)
- For UPI alerts: "debited", "paid", "transferred" all mean an expense
- For credit card SMS: look for "spent", "transaction", "purchase"
- Merchant should be the shop/app name, not the bank name
- confidence = 1.0 means everything is clear; lower if key fields are guessed`;

export async function parseTransactionText(
  text: string,
  userRegion?: string,
  todayDate?: string
): Promise<ParsedTransaction> {
  const userContext = [
    userRegion ? `User is in ${userRegion}.` : "",
    todayDate ? `Today's date is ${todayDate}.` : `Today's date is ${new Date().toISOString().split("T")[0]}.`,
  ].filter(Boolean).join(" ");

  const raw = await generateText(
    `${userContext}\n\nParse this text:\n\n${text}`,
    SYSTEM_PROMPT,
    1024
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]) as ParsedTransaction;
}
