# How input becomes transactions

Five entry points, one parser, one write rule. Anything that turns a document
into rows goes through the whole chain below — only the entry differs.

```
ENTRY                          NORMALISE            PARSE          WRITE
─────                          ─────────            ─────          ─────
camera / gallery ──┐
PDF upload ────────┤
pasted text ───────┼──────────→  units  ──────→  parse_units  ──→  expand
iOS Shortcut ──────┤                              (1 prompt)        or fold
Gmail import ──────┘                                                  ↓
                                                              append_transactions
```

## 1. Entry points

```
camera / gallery image
  POST /api/receipts/upload      → Drive + placeholder (queued)
  POST /api/receipts/process     → receipt_processing_service
                                 → image_unit

PDF  (same "Upload file" button on Capture)
  POST /api/parse/statement/async → Drive + placeholder (named after the file)
                                  → statement_parse_job
                                  → collect_units(pdf)

pasted text / SMS
  POST /api/parse/text/async     → placeholder
                                 → text_parse_job → text_unit

iOS Shortcut          (synchronous — no placeholder, returns the row)
  POST /api/shortcut/log         → text_unit

Gmail                 (cron 12:00 IST, or "Fetch now")
  email_import_job
    fetch_attachments            (opt-in, default ON, <=60 per message)
    collect_message_units        → group_units → 1 group = 1 payment
```

A forwarded mail carrying fifty `.eml` files becomes fifty groups and therefore
fifty transactions. Putting them in one group would collapse them into a single
row and silently lose forty-nine payments.

## 2. Normalise to units

`app/extract/` turns any artifact into the two shapes the AI chains accept.

```
PDF  ─→ extract/pdf.py ─┬─ text layer >=200 chars/page → document unit
                        └─ scanned                     → images unit (1/page)

.eml ─→ extract/eml.py ─→ email unit + its own attachments (recurse, depth <=2)

image ────────────────────────────────────────────────→ images unit
text  ────────────────────────────────────────────────→ text  unit
```

Reading a digital PDF's text layer keeps the digits exact and costs no vision
tokens. Only a scan is rasterised.

## 3. One parser — `app/ai/parser.py`

```
cheap guards        body <80 chars → too_short      (no AI call)
                    no money words → no_signal      (no AI call)
      ↓
build_prompt        From / Subject / Received: <date> / body / documents
      ↓
ONE SYSTEM_PROMPT   text units  → text chain   (1 call)
                    image units → image chain  (1 call per page)
      ↓
validate_transaction  per row — amount <=500k, confidence floor, date window,
                      category/method enums, uncertain_fields → notes
      ↓
doc_type            purchase  → 1 payment  (>1 row collapses to the largest)
                    statement → many payments (every row kept)
```

`Received:` matters more than it looks. Without the email's own date the model
falls back to today, which both misfiles the spend and pushes the row outside
the duplicate check's window.

`purchase` collapsing to the largest row is the backstop for component
invoices: a Zomato order arrives as a body plus an order summary, the
restaurant's tax invoice and the platform's fee invoice, whose amounts differ.
Recorded separately they triple the spend, and no duplicate check can recover
it — the amounts and the legal-entity merchant names genuinely differ.

## 4. One write rule — every writer

Applied by `receipt_processing_service`, `statement_parse_job`,
`email_import_job`, `text_parse_job` and `routers/shortcut`.

```
priced_items(items)
   │
   ├─ >1 priced  →  build_item_rows()   row per item
   │                                    + "Other Items" (shortfall)
   │                                    + "Discount"    (excess)
   │                                    rows sum to the amount charged
   │
   └─ 0 or 1     →  fold_items()        names → notes
                                        item_name = "First +N more"
   ↓
append_transactions()   ONE request, however many rows
```

The split needs real per-item prices. An Amazon order prices every line, so it
expands; a Zomato email names dishes without pricing them, so it folds.
Splitting a total across unpriced lines would be inventing the numbers.

Both balancer rows exist so the rows always sum to what was actually charged —
a shortfall is unnamed tax or delivery, an excess is an order discount.

## 5. Duplicates

```
email import  → deduplicate_new_transactions   (immediately after the run)
                  candidates = new rows' date span +/-3 days
                  1 AI call per distinct date
                  flags is_duplicate + duplicate_ref — never deletes

daily cron    → run_duplicate_detection        (separate, whole-sheet pass)
```

Scoping by date rather than recency is deliberate: an emailed statement can add
a hundred rows spanning months, which would flood a recent-N window and push out
the very originals they duplicate. The +/-3 day widening covers cards, where a
bank alert carries the transaction date but the statement carries the posting
date.

## 6. What the email import revisits

Gmail is listed with `nextPageToken` followed to the end, capped at
`MAX_MESSAGES_PER_RUN`, then **reversed** — Gmail returns newest-first, so the
unprocessed backlog is at the end. Without the reverse, a run re-walks the newest
page and never reaches older mail.

Every message ends with one row in `parsed_emails`. Only `failed` is retried:

| status | meaning | next run |
|---|---|---|
| `parsed` | rows written, no group errored | terminal |
| `partial` | rows written, some group errored | terminal, logged as an error |
| `skipped` | a real verdict — no debit, guard rejected it | terminal |
| `failed` | nothing written, and a group errored | retried |

The dividing line is **whether rows were written**, not whether something went
wrong. A retry re-imports every group, and the duplicate scan only *flags*
duplicates, so retrying a partially-imported message would leave real duplicate
rows behind. That case is therefore made loud rather than repeated.

`parse_error` (the AI chain raised) always counts as retryable. `ai_null` is
ambiguous — usually the model correctly reporting no debit, occasionally a
non-JSON response — so it is retried exactly once, which distinguishes the two
without looping forever on marketing email.

## Where paths still differ, and why

**Placeholders.** Receipt, PDF and text create a queued row first, so progress is
visible and a stalled parse can be retried. The Shortcut writes synchronously
and returns the row, because installed shortcuts read that response.

**Expand vs fold** is decided by the source, not the entry point — whether the
document priced its lines.

**Dedup** runs automatically only after an email import. Uploads rely on the
daily cron pass.
