# Merge Duplicates

Combines two or more duplicate transactions into a single clean entry by letting AI pick the best details from each.

---

## How to use it

In the Transactions list, tap the **Duplicates** chip to see grouped duplicates. Open a group and tap **Merge into one**.

---

## What happens step by step

1. After you tap **Merge into one**, the sheet closes and a temporary **"Merging…"** entry appears in your transaction list.

2. In the background, AI looks at all the duplicate entries and builds one merged transaction using the best available information — the clearest merchant name, the correct amount, the most complete notes, and any receipt image.

3. When done, the "Merging…" placeholder is reliably replaced by the finished merged transaction and the original duplicate entries are removed from view. (Previously, the placeholder could stay stuck at "Merging…" even after the AI finished — this is now fixed.)

4. If merging fails, an error indicator appears on the placeholder. The app tries again up to three times automatically, and also retries once per day overnight.

5. If the server restarts mid-merge, the "Merging…" placeholder is automatically cleaned up during the next daily run (within 30 minutes of the scheduled job). It will be marked as failed so you know to retry it.

---

## What it looks like

The merged result shows as a single normal transaction in your list. You can tap it to edit any field if something does not look right.

---

## Related features

Duplicates are found by the **Duplicate Detection** feature, which runs automatically every day and can also be triggered manually from the Transactions filter bar.
