# Receipt Camera

Lets you photograph a receipt — or upload or paste an image — and have AI read every line item and add them as individual transactions automatically.

---

## How to use it

Open the **Capture** screen and switch to the **Camera** tab. Choose how you want to provide the image:
- Tap **Open Camera** to take a photo right now
- Tap **Pick from Gallery** to choose a saved image
- Tap **Paste Image** to use an image from your clipboard (or press Ctrl+V)

---

## What happens step by step

1. After you take or choose a photo, the app shows **"Saving to Drive…"** while the image is uploaded securely to your account.

2. You see **"Saved! AI is reading your receipt in the background…"** and are taken to your Transactions list after a moment.

3. A temporary **"Processing…"** entry appears at the top of the list to show the receipt is being read.

4. In the background, AI scans the receipt — using the same prompt and parsing flow as text capture — and extracts each line item: name, quantity, unit, unit price, and total, along with the merchant name and categories.

5. When finished, the result is reliably written to your sheet. One of two things happens:
   - **Multiple items** — the placeholder disappears and each item becomes its own transaction entry. If the receipt total is higher than the sum of line item prices (due to taxes or fees), an extra **"Taxes & Fees"** row is appended for the difference. All rows from the same receipt share a common receipt ID so they can always be traced back together.
   - **Single item** — the placeholder is updated in place with the item details (name, quantity, category).

6. If you have push notifications turned on, a notification arrives on your device to let you know the receipt is done — even if the app is not open.

---

## What it looks like

Each line item from the receipt appears as a separate transaction. You can tap any of them to edit the details if anything was read incorrectly.

---

## Related features

Turn on **Push Notifications** in Settings to get alerted as soon as a receipt is processed.
