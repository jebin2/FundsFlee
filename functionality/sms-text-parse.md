# SMS and Text Capture

Lets you paste a bank SMS or any payment notification text into the app so AI can read it and create a transaction automatically.

---

## How to use it

Open the **Capture** screen — the paste tab is shown by default. Paste or type a bank SMS, UPI alert, or any payment message into the text box, then tap **Log with AI**.

You can also share a message directly from your phone's Messages app — tap Share and choose FundsFlee, and the text will arrive pre-filled in the capture box.

---

## What happens step by step

1. After you tap **Log with AI**, you are taken to your Transactions list immediately — you do not need to wait.

2. A temporary **"Parsing SMS…"** entry appears at the top of the list while the text is being read.

3. In the background, AI reads the message and extracts the transaction details: date, time, amount, merchant, category, payment method, notes, and any individual line items with their quantities.

4. When done, the transaction is reliably updated in your sheet. One of two things happens depending on how many items were found:
   - **Single item or no items** — the placeholder is updated in place with all extracted details, including item name and quantity if available.
   - **Multiple items** — the placeholder is removed and each item becomes its own separate transaction entry with its individual price, name, and quantity. If the grand total is higher than the sum of item prices (due to taxes, marketplace fees, or delivery charges), an extra **"Taxes & Fees"** row is added automatically for the difference. All rows from the same order share a common order ID so they can always be traced back together.

5. If the AI cannot read the message — for example, if it is not a payment notification — the entry stays but shows an error state. You can edit it manually or delete it.

---

## What kinds of text work

The AI can read bank debit alerts, UPI payment confirmations, credit card transaction notifications, and most other payment SMS formats. Order confirmation emails and pasted order summaries (such as Amazon or Flipkart orders) also work — each item in the order becomes its own transaction.

---

## Related features

For fully automatic SMS capture on iPhone, set up the **iPhone Shortcut Automation** so messages are sent to FundsFlee the moment they arrive, without any copy-pasting.
