/**
 * Tap-to-add suggestions for the email import filters.
 *
 * Senders are partial matches, so short tokens beat full addresses: "hdfcbank"
 * catches alerts@hdfcbank.bank.in, alerts@hdfcbank.net and whatever the bank
 * switches to next. These are suggestions only — nothing is applied until the
 * user taps it.
 */
export interface PresetGroup {
  label: string;
  values: string[];
}

export const SENDER_PRESETS: PresetGroup[] = [
  {
    label: "Banks & cards",
    values: ["hdfcbank", "icicibank", "axisbank", "sbi", "kotak", "onecard", "slicepay"],
  },
  {
    label: "Payments",
    values: ["phonepe", "razorpay", "paytm", "googlepay", "cred", "billdesk"],
  },
  {
    label: "Food & groceries",
    values: ["zomato", "swiggy", "blinkit", "zepto", "bigbasket", "dunzo"],
  },
  {
    label: "Shopping",
    values: ["amazon", "flipkart", "myntra", "ajio", "nykaa"],
  },
  {
    label: "Travel",
    values: ["uber", "ola", "rapido", "irctc", "makemytrip", "redbus"],
  },
  {
    label: "Subscriptions",
    values: ["netflix", "spotify", "youtube", "steampowered", "apple", "anthropic", "openai"],
  },
];

/**
 * Subject matches are whole phrases, so these lean specific. A bare "payment"
 * or "order" will pull in newsletters and delivery updates too — worth it only
 * for a mailbox you forward into deliberately.
 */
export const SUBJECT_PRESETS: PresetGroup[] = [
  {
    label: "Transaction alerts",
    values: ["debited", "payment successful", "transaction alert", "txn alert"],
  },
  {
    label: "Orders & bills",
    values: ["your order", "order confirmation", "invoice", "receipt", "statement"],
  },
];
