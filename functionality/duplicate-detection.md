# Duplicate Detection

Finds transactions recorded more than once — for example, the same Zomato payment captured from both a receipt scan and a bank email.

---

## How to use it

Tap the **Duplicates** chip in the Transactions filter bar.

It also runs automatically every day at **12:00 PM** as part of the scheduled jobs.

---

## What happens step by step

1. The chip immediately shows a **"Checking…" spinner** — this spinner stays even if the page is refreshed or opened in a new tab, because the running state is stored in the sheet, not just in memory.

2. AI scans all transactions looking for entries that represent the same real payment. It handles:
   - Slightly different merchant spellings — "OPENMART" vs "OPEN MART"
   - Small amount differences — bank shows ₹330, PhonePe shows ₹353 for the same Airtel recharge
   - Same UPI reference number in different entries

3. When done, the sheet is updated and the spinner disappears. Any duplicates found now appear in the list.

---

## What the duplicates list looks like

Each card shows a duplicate group — for example "Zomato ₹346 · 2 entries".

Tap a card to open the details:
- All duplicate entries shown side by side
- Tap any entry to view its full transaction details
- **Remove** — deletes that specific entry
- **Merge into one** — AI picks the best data from each entry and combines them into one clean transaction
- **Keep all** — marks the group as intentional, not a duplicate

In the **All** tab, each duplicate entry also shows inline **Keep** and **Remove** buttons beneath it. If you manually delete a transaction (via its detail sheet) that other entries were flagged against, those entries are automatically cleaned up — their duplicate flags are cleared so the Keep/Remove buttons no longer appear.

---

## Cooldown

Tapping the chip skips the scan silently if it ran within the last hour. The daily scheduled job always runs.

---

## Scheduled Tasks page

When detection is running — from either the chip or the daily schedule — the **Duplicate Detection** row in Settings → Scheduled Tasks shows a spinner and its Run button is disabled, exactly like how the Email Import row behaves when email is being fetched.
