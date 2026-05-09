# AI Insights — Complete Specification

> Every AI capability the app has, listed individually.
> All powered by Claude claude-sonnet-4-6 via Anthropic SDK with prompt caching.

---

## Table of Contents

1. [Input Processing Agents](#1-input-processing-agents)
2. [Duplicate & Data Quality Agents](#2-duplicate--data-quality-agents)
3. [Spending Pattern Insights](#3-spending-pattern-insights)
4. [Merchant & Item Intelligence](#4-merchant--item-intelligence)
5. [Subscription & Recurring Detection](#5-subscription--recurring-detection)
6. [Behavioural & Temporal Patterns](#6-behavioural--temporal-patterns)
7. [Budget & Pace Alerts](#7-budget--pace-alerts)
8. [Optimisation & Reduction Suggestions](#8-optimisation--reduction-suggestions)
9. [Region-Aware Alternatives](#9-region-aware-alternatives)
10. [Category-Specific Deep Dives](#10-category-specific-deep-dives)
11. [Narrative & Summary Generation](#11-narrative--summary-generation)
12. [Proactive Nudges](#12-proactive-nudges)
13. [Insight Delivery & Scheduling](#13-insight-delivery--scheduling)

---

## 1. Input Processing Agents

These agents run on every new entry before it reaches the database.

---

### 1.1 SMS / Email Text Parser

**What it does:**
Reads raw copy-pasted SMS or email text and extracts a fully structured transaction.

**Handles:**
- Indian bank SMS formats (HDFC, ICICI, Axis, SBI, Kotak, IDFC, etc.)
- UPI payment notifications (PhonePe, GPay, Paytm, BHIM)
- Credit/debit card swipe alerts
- Swiggy, Zomato, Amazon, Flipkart, Blinkit order confirmations
- Electricity, mobile recharge, utility payment receipts
- Generic "You have spent INR X at Y" patterns
- Multi-line email receipts with itemised lists

**Output:**
- Merchant name
- Amount (INR)
- Date & time
- Category (auto-assigned)
- Subcategory
- Items (if listed in the message)
- Payment method
- Confidence score per field
- List of fields it is uncertain about (shown in amber in UI)

**Fallback:**
If parsing confidence is below 0.6, prompts user to fill in the highlighted fields manually rather than silently guessing.

---

### 1.2 Receipt / Photo Parser

**What it does:**
Reads a photo of a physical or printed receipt using Claude Vision and extracts structured transaction data.

**Handles:**
- Restaurant bills (itemised)
- Grocery store receipts (multi-item)
- Retail/clothing shop receipts
- Pharmacy bills
- Fuel station slips
- Handwritten amounts on basic receipts
- Partial or crumpled receipts (marks unreadable sections as uncertain)
- Receipts with GST breakdown (extracts pre-tax amount + GST separately)

**Output:**
Same schema as SMS parser, plus:
- Individual line items with qty and unit price
- GST amount (if present)
- Receipt number (if present)

**Fallback:**
If image is too blurry or dark, returns what it can read and flags remaining fields as uncertain — user always sees a confirmation screen before saving.

---

### 1.3 iPhone Shortcut Auto-Entry

**What it does:**
Accepts a POST request from an iPhone Shortcut (triggered when user shares an SMS or mail) and processes it exactly like the text parser, then auto-saves after parsing.

**Returns to the Shortcut:**
- Merchant name + amount for the notification message
- Whether a duplicate was detected
- The saved entry ID

**No UI confirmation in this flow** — designed for speed. User can always edit the saved entry from the transactions list.

---

### 1.4 Auto-Categorisation

**What it does:**
Every entry (regardless of input method) is auto-assigned a category and subcategory by Claude if not already assigned.

**Uses:**
- Merchant name heuristics (Swiggy → Food & Dining → Food Delivery)
- Item names from receipts
- Payment context from SMS
- User's past categorisation for the same merchant (learning from history)

**Behaviour:**
- If merchant was categorised differently by user before → uses user's category (user preference wins)
- If new merchant → Claude assigns based on name + context
- Shows category as editable on confirmation screen

---

## 2. Duplicate & Data Quality Agents

---

### 2.1 Exact Duplicate Detector

**What it does:**
After every new entry is saved, compares it against the last 90 days of transactions to detect exact duplicates.

**Triggers a duplicate flag when:**
- Same merchant + same amount + within 2 hours → confidence: very high
- Same merchant + same amount + same day → confidence: high
- Same amount + same day + similar merchant name (fuzzy match) → confidence: medium

**Output:**
- Duplicate flag on both entries
- Reason shown to user: "Same amount at Swiggy, 14 minutes apart"
- User action: Keep both / Remove new / Remove old

---

### 2.2 Fuzzy Duplicate Detector

**What it does:**
Catches near-duplicates where amount or merchant name differs slightly — common when the same purchase appears in both a bank SMS and a Swiggy confirmation email.

**Catches:**
- Same merchant + amount differs by ±5% (tip variation, rounding)
- Merchant name variations: "SWIGGY" vs "Swiggy*food" vs "SWIGGY INSTAMART"
- Same merchant + adjacent dates (user entered yesterday's receipt today)

**Output:**
- "Possible duplicate" flag (lower confidence than exact)
- Side-by-side comparison shown to user before they decide

---

### 2.3 Entry Correction Suggester

**What it does:**
Flags entries that look statistically anomalous and may be data entry errors.

**Flags:**
- Amount seems too high for the category (₹50,000 at a cafe — likely a typo for ₹500)
- Amount is round number suspiciously inconsistent with category (₹10,000 at a grocery store — prompt to verify)
- Merchant name looks garbled (OCR artifact from receipt)
- Date is in the future

**Output:**
- Soft warning inline on the transaction card
- "Does this look right?" prompt — tap to edit

---

### 2.4 Merchant Name Normaliser

**What it does:**
Silently standardises merchant names so the same place doesn't appear as 3 different merchants across entries.

**Examples:**
- "SWIGGY", "Swiggy*food", "Swiggy Instamart" → grouped under "Swiggy"
- "AMAZONIN", "Amazon.in", "AMZN" → "Amazon"
- "BIG BASKET", "Bigbasket.com", "BB DAILY" → grouped by Claude into display name

**Output:**
- `merchant_canonical` field stored alongside raw merchant name
- All analysis and comparison uses canonical name
- User can override grouping in settings

---

## 3. Spending Pattern Insights

These run as part of the Analysis Agent for a selected period.

---

### 3.1 Period Spend Summary

**What it does:**
Compares total spend in the selected period vs the previous same-length period.

**Shows:**
- Total amount spent
- % change vs previous period (up/down arrow + colour)
- Number of transactions
- Average spend per day

**Example output:**
> "You spent ₹14,200 this month — 22% more than March. You had 67 transactions, averaging ₹473/day."

---

### 3.2 Category Spend Breakdown

**What it does:**
Ranks all categories by spend for the period and highlights shifts from the previous period.

**Shows per category:**
- Amount spent
- % of total spend
- Number of transactions
- Change vs previous period (↑ ₹800 more on Transport)

**Flags:**
- Categories with >30% increase vs previous period
- Categories that appeared for the first time

---

### 3.3 Top Merchant Breakdown

**What it does:**
Ranks merchants by total spend and visit frequency for the period.

**Shows per merchant:**
- Total spend
- Number of visits
- Average spend per visit
- Trend vs previous period

**Insight example:**
> "Swiggy: 18 orders this month, avg ₹380/order. Your most frequent merchant."

---

### 3.4 Spend Velocity Tracker

**What it does:**
Tracks how fast money is being spent compared to the same point in the previous period.

**Example:**
> "By Day 10 of April you've spent ₹8,400. At the same point in March you'd spent ₹5,200. You're on track to exceed last month by ~60%."

---

### 3.5 Largest Single Transactions

**What it does:**
Highlights the top 5 largest individual transactions in the period and asks if they were planned or unexpected.

**Output:**
- Ranked list with merchant + amount + date
- Flags any that are unusually large for that category

---

### 3.6 Spending Concentration Score

**What it does:**
Measures how concentrated spending is — did most money go to 1–2 merchants/categories, or spread wide?

**Example:**
> "68% of your spend this month went to just 3 merchants: Swiggy, Amazon, and Big Basket. This concentration makes it easy to reduce spend by targeting these specifically."

---

## 4. Merchant & Item Intelligence

---

### 4.1 Item Price Tracker

**What it does:**
Across all transactions, identifies the same item bought at different merchants and tracks price over time.

**Detects:**
- Same item name (with fuzzy matching) across different merchants
- Price changes at the same merchant over time
- Items where price differs significantly between merchants

**Example:**
> "Amul Full Cream Milk 1L: Big Basket ₹68 | Blinkit ₹72 | Local shop ₹60"

---

### 4.2 Same-Item Cross-Merchant Comparison

**What it does:**
Generates a comparison table for items you regularly buy from multiple places.

**Output per item:**
- Item name
- Each merchant where you've bought it
- Last price, average price, times bought
- "Best value" badge on the cheapest

**Example:**
> "Coffee: Starbucks avg ₹380 (3x) | Café Coffee Day avg ₹175 (5x) | Blue Tokai avg ₹220 (2x)"

---

### 4.3 Merchant Loyalty Value Checker

**What it does:**
For merchants you visit repeatedly, calculates whether the loyalty (frequency) is giving you value or just habit.

**Flags:**
- You visit X often but spend varies wildly (inconsistent pricing or portion sizes)
- A nearby alternative is consistently cheaper based on your own receipts
- You have a subscription/membership at a merchant but your visit frequency doesn't justify it

---

### 4.4 Price Inflation Detector (per item)

**What it does:**
Detects if a recurring item's price has quietly increased over time.

**Example:**
> "Your usual Zomato Biryani order has gone from ₹280 → ₹320 → ₹360 over 3 months (+28%). Not a splurge, just inflation to be aware of."

---

### 4.5 Online vs Offline Purchase Split

**What it does:**
Compares how much is spent online (Swiggy, Amazon, Blinkit) vs in-person for the same category.

**Example:**
> "Groceries: ₹3,200 via Blinkit/BigBasket online vs ₹1,800 at in-person shops. Online is ₹1,400 more — partly convenience, partly markup."

---

## 5. Subscription & Recurring Detection

---

### 5.1 Auto-Subscription Detector

**What it does:**
Scans transaction history to automatically detect recurring charges that look like subscriptions, even if not explicitly tagged.

**Detects:**
- Same merchant + same or similar amount + monthly/weekly pattern
- OTT platforms: Netflix, Hotstar, Prime Video, SonyLIV, Zee5, JioCinema
- Cloud storage: Google One, iCloud
- Music: Spotify, JioSaavn, Apple Music
- Gym memberships
- Domain/hosting renewals
- Software (Adobe, Microsoft 365, Notion)
- Any recurring UPI debit

**Output per detected subscription:**
- Merchant
- Amount
- Frequency (monthly/annual/weekly)
- Annual cost extrapolated
- First detected date

---

### 5.2 Subscription Audit

**What it does:**
Analyses all detected subscriptions and asks Claude to assess which seem underused based on surrounding transaction context.

**Example:**
> "You have 3 OTT subscriptions: Netflix (₹649/mo), Hotstar (₹299/mo), Prime (₹299/mo) = ₹1,247/month = ₹14,964/year. Consider pausing one — many shows overlap across platforms."

**Flags:**
- Subscriptions with no related activity in 45+ days (e.g., gym membership but no pharmacy/health transactions)
- Duplicate-purpose subscriptions (3 music apps)
- Unused trials that converted to paid

---

### 5.3 Bill Due Predictor

**What it does:**
Based on past recurring transactions, predicts upcoming bills and their approximate amounts.

**Example:**
> "Your electricity bill (avg ₹1,840) is due around the 15th. Your Airtel bill (₹599) is due in 3 days."

Shown as a card on the dashboard when a bill is within 5 days.

---

### 5.4 Subscription Cost Tracker (Annual View)

**What it does:**
Extrapolates all recurring charges to an annual number, showing true cost of subscriptions.

**Output:**
- Table of all subscriptions with monthly + annual cost
- Total subscription burden per month
- % of total monthly spend going to subscriptions

---

## 6. Behavioural & Temporal Patterns

---

### 6.1 Day-of-Week Spending Pattern

**What it does:**
Analyses which days of the week you spend the most and least.

**Example:**
> "You spend 2.4x more on weekends vs weekdays. Saturday is your highest spend day (avg ₹920). Tuesday is lowest (avg ₹180)."

---

### 6.2 Time-of-Day Pattern

**What it does:**
If transaction times are available, identifies peak spending hours.

**Example:**
> "38% of your food delivery orders happen between 9 PM–11 PM. Late-night ordering tends to be less planned and pricier."

---

### 6.3 Month-Progression Pattern

**What it does:**
Tracks whether spending is front-loaded or back-loaded in the month.

**Example:**
> "You tend to spend heavily in the first 10 days after salary credit, then slow down. Days 1–10 account for 52% of monthly spend."

---

### 6.4 Impulse Buy Detector

**What it does:**
Flags transactions that match impulse purchase patterns based on: time (late night), category (shopping/entertainment), merchant (Amazon/Myntra), and frequency clusters (multiple purchases within 2 hours).

**Example:**
> "3 Amazon orders placed between 11 PM–1 AM this month totalling ₹4,200. Nighttime browsing seems to cost you."

---

### 6.5 Payday Effect Tracker

**What it does:**
Compares spending in the first week after salary date vs the rest of the month.

**Requires:** user sets salary date in settings (optional).

**Example:**
> "First week of month (post-salary): ₹6,800 spent. Remaining 3 weeks: ₹7,400. Your spending is fairly balanced — you don't splurge heavily on payday."

---

### 6.6 Seasonal Spending Shift

**What it does:**
Over 3+ months of data, identifies seasonal patterns — festival spending, summer/winter shifts, school year patterns.

**Example:**
> "Your October spend is typically 40% higher than average — Diwali shopping and gifting. Worth planning a small reserve."

---

### 6.7 Stress Spending Detector

**What it does:**
Looks for unusual clustering of discretionary spend (food delivery, entertainment, shopping) in concentrated periods, which can correlate with stress spending.

**Non-judgmental output:**
> "Noticed a cluster of 8 food delivery orders across 3 days (22nd–24th). Nothing wrong with that — just worth knowing if you were going through a tough week."

---

## 7. Budget & Pace Alerts

---

### 7.1 Monthly Budget Pace Alert

**What it does:**
If a budget is set for a category, alerts when spending is on track to exceed it.

**Example:**
> "Food & Dining: You've spent ₹3,200 by Day 12. At this pace you'll hit ₹8,000 by month end — your budget is ₹6,000."

---

### 7.2 Category Spike Alert

**What it does:**
Without needing a budget, alerts when any category spends significantly more than the user's personal average.

**Example:**
> "Health spending this month: ₹4,800. Your 3-month average is ₹1,200. Likely a one-off (illness, dental) — flagging so it doesn't surprise your month-end review."

---

### 7.3 Daily Spend Rate Alert

**What it does:**
Nudges if today's spend is unusually high compared to the user's average daily spend.

**Example:**
> "You've spent ₹3,200 today — 4x your daily average of ₹780. Big day?"

Shown as a dashboard nudge card, not a loud notification.

---

### 7.4 Savings Rate Estimator

**What it does:**
If user provides monthly income in settings (optional), estimates savings rate.

**Example:**
> "Estimated this month: ₹42,000 income, ₹26,400 spend = 37% savings rate. That's solid — national average is closer to 20%."

---

## 8. Optimisation & Reduction Suggestions

Each suggestion includes: estimated monthly saving, effort level (Low / Medium / High), quality impact (Better / Neutral / Slightly lower).

---

### 8.1 Food Delivery Reduction

**What it does:**
Analyses food delivery frequency and spend, and suggests a realistic reduction with savings estimate.

**Example:**
> "You ordered food delivery 22 times this month (avg ₹420/order = ₹9,240). Cooking at home for 8 of those meals (weekday lunches) could save ~₹2,800/month. Effort: Medium. Quality: Neutral."

---

### 8.2 Grocery Platform Optimisation

**What it does:**
Compares prices across grocery platforms you use and suggests the better one for your basket.

**Example:**
> "Your regular Big Basket basket costs ~₹3,400. The same items on Blinkit run ~₹3,700 (convenience premium). Stick to Big Basket for planned buys, Blinkit only for urgent needs."

---

### 8.3 Transport Mode Suggestion

**What it does:**
Analyses Ola/Uber spend vs public transport options available in the user's city.

**Example (Chennai):**
> "You spent ₹4,200 on Ola this month. Your ride pattern suggests 60% are routes covered by MTC or Metro. A Metro card + occasional Ola could save ~₹2,000/month. Effort: Low."

---

### 8.4 Subscription Consolidation

**What it does:**
Suggests which subscriptions to pause, consolidate, or switch plan for.

**Example:**
> "Switching Netflix from Premium (₹649) to Standard (₹499) saves ₹1,800/year. Pausing Hotstar for 3 months (IPL is over) saves ₹900. Total potential: ₹2,700/year."

---

### 8.5 Bulk Buy Opportunity

**What it does:**
Identifies items bought frequently in small quantities that are cheaper per-unit when bought in bulk.

**Example:**
> "You buy 1L milk almost daily from Blinkit at ₹72. Big Basket subscription (6L/week) works out to ₹62/L — saving ₹350/month."

---

### 8.6 Eating Out Frequency Optimiser

**What it does:**
Analyses restaurant visit frequency and suggests which days/meals to substitute.

**Example:**
> "You eat out for lunch 4–5 times/week (avg ₹220/meal). Carrying lunch 2 days/week (estimated cost ₹40–60/meal) saves ~₹700/month. Effort: Medium."

---

### 8.7 Premium vs Regular Quality Check

**What it does:**
Identifies categories where you consistently choose premium options and checks if lower-tier alternatives exist with similar reviews.

**Example:**
> "You consistently order from premium cloud kitchens (avg ₹480/order). Several well-rated budget alternatives in your area average ₹220. Not suggesting a downgrade — just options."

---

### 8.8 Cashback & Offer Opportunity

**What it does:**
Looks at your spending categories and payment methods and mentions relevant cashback patterns.

**Note:** Does not link to specific offers (those change). Gives general guidance.

**Example:**
> "You spend ₹12,000+/month on groceries + food delivery via UPI. Most credit cards offer 5–10% cashback on these categories — worth checking if your card does."

---

### 8.9 Habit Loop Identifier

**What it does:**
Identifies repeated spending patterns that look automatic/habitual rather than intentional.

**Example:**
> "Every Saturday morning: Starbucks (₹380). Every Sunday evening: Swiggy (avg ₹620). These are consistent — just surfacing them so they're a conscious choice, not auto-pilot."

---

## 9. Region-Aware Alternatives

The user's city/region (from profile) is passed to Claude so all suggestions are locally relevant.

---

### 9.1 Local Market Alternatives

**What it does:**
Suggests local markets, mandis, or neighbourhood stores as alternatives to app-based grocery/vegetable shopping.

**Calibrated to city:**
- Chennai: Koyambedu market, neighbourhood Amma Unavagam
- Bangalore: Russell Market, HOPCOMS
- Mumbai: Crawford Market, APMC
- Delhi: INA Market, local sabzi mandis

**Example (Chennai):**
> "You spend ₹2,800/month on BigBasket vegetables. Koyambedu market or your local vegetable vendor typically runs 25–40% cheaper. Quality is comparable or better for seasonal produce."

---

### 9.2 Local Restaurant Alternatives

**What it does:**
Suggests local restaurant equivalents for common cuisine types, positioned as equal or better quality but lower cost.

**Example:**
> "You spend ₹8,200 on restaurant meals. Many localities have darshinis / mess-style restaurants serving the same cuisine at ₹80–120/meal vs ₹250–400 at the places you frequent. Worth exploring."

---

### 9.3 City-Specific Transport Optimisation

**What it does:**
Gives transport suggestions specific to the user's city's available infrastructure.

**Examples:**
- Chennai: MTC bus, MRTS, Chennai Metro, share autos
- Bangalore: BMTC, Namma Metro, BBMP cycle rental
- Mumbai: Local train, BEST bus, harbour line

---

### 9.4 Festival & Seasonal Buying Guide

**What it does:**
Reminds users of optimal times to buy certain categories based on Indian seasonal patterns.

**Example:**
> "Electronics: Best prices during Diwali sales (Oct/Nov), Republic Day sales (Jan 26), and end of financial year (March). If you're planning a phone purchase, April may not be the ideal month."

---

### 9.5 Government Scheme Awareness

**What it does:**
For relevant spending categories, mentions if there are government subsidies or schemes available in the user's state.

**Example:**
> "You spend on LPG cylinders. Ensure you're registered under PMUY (PM Ujjwala Yojana) if eligible — subsidised cylinders at lower cost."

*This is informational only — Claude does not verify eligibility or link to external sites.*

---

## 10. Category-Specific Deep Dives

Each category has a dedicated set of sub-insights shown when user taps a category bar in the analysis view.

---

### 10.1 Food & Dining Deep Dive

- Home cooking vs delivery ratio
- Breakfast / Lunch / Dinner split (inferred from order times)
- Most ordered items across all receipts
- Cuisine preference breakdown
- Platform comparison (Swiggy vs Zomato vs direct)
- Average delivery fee paid per month

---

### 10.2 Transport Deep Dive

- Ola/Uber vs auto vs public transport split
- Fuel spend and estimated monthly mileage (if petrol receipts captured)
- Longest/most expensive single trip of the month
- Airport/outstation trips flagged separately

---

### 10.3 Grocery Deep Dive

- Most frequently bought items
- Estimated cost per meal from grocery spend
- Platform split (BigBasket vs Blinkit vs in-person)
- Wastage risk: items bought regularly in bulk (could be over-buying)

---

### 10.4 Health Deep Dive

- Pharmacy spend breakdown (medicines vs vitamins/supplements)
- Doctor/lab test spend flagged as one-off vs recurring
- Gym/fitness spend tracked
- Month-over-month health spend trend (flags sustained increase)

---

### 10.5 Shopping Deep Dive

- Online vs in-person split
- Return rate estimate (if refund credits appear in transactions)
- Most purchased product types
- Impulse vs planned purchase ratio (inferred from time-of-day)

---

### 10.6 Bills & Utilities Deep Dive

- Fixed vs variable bills breakdown
- Electricity trend (higher in summer → AC usage)
- Mobile plan cost per GB (rough estimate if plan amount known)
- EMI burden as % of monthly spend

---

## 11. Narrative & Summary Generation

---

### 11.1 Monthly Narrative

**What it does:**
Generates a 3–5 sentence plain-language summary of the month's spending — written like a friend reviewing your finances, not a financial advisor.

**Tone:** Friendly, non-judgmental, specific.

**Example:**
> "April was a spendy month overall — ₹16,800 vs ₹13,200 in March. The jump is mostly explained by that dental appointment (₹4,200) which was clearly unavoidable. Food delivery crept up again, and there were a few late-night Amazon purchases. Utilities were lower though, which is nice. All up, a reasonable month with one big one-off."

---

### 11.2 Weekly Snapshot

**What it does:**
A shorter 1–2 sentence snapshot for the week. Designed for the push notification summary.

**Example:**
> "This week: ₹3,840 across 14 transactions. Heaviest day was Saturday (₹1,200 — lunch out + grocery run)."

---

### 11.3 Daily Digest (optional)

**What it does:**
End-of-day summary of what was spent. Opt-in setting.

**Example:**
> "Today: ₹820 — Zomato lunch (₹360), Metro card top-up (₹200), coffee (₹120), pharmacy (₹140)."

---

### 11.4 Year-in-Review (annual, Dec 31)

**What it does:**
Generates a full-year narrative on Dec 31 covering: total spend, biggest categories, top merchants, biggest single purchase, how spending changed month-to-month, and what the next year could look like with small changes.

---

## 12. Proactive Nudges

These appear on the dashboard as a single rotating insight card. One at a time, most relevant first.

---

| Nudge | Trigger condition |
|---|---|
| "You may have a duplicate" | Dedup agent flagged something |
| "Subscription detected" | New recurring charge identified |
| "Bill due soon" | Recurring bill within 5 days |
| "Spending faster than usual" | 30%+ ahead of same-period pace |
| "Big one-off this week" | Single transaction > 2x daily average |
| "Haven't logged in 3 days" | No entries for 3+ days (gentle reminder) |
| "Monthly analysis ready" | Auto-analysis completed in background |
| "Price went up" | Detected price increase on a regular item |
| "You're doing well" | Month on track / below average spend (positive reinforcement) |
| "Subscription unused" | Subscription with no correlated activity in 45 days |

---

## 13. Insight Delivery & Scheduling

### Where insights appear

| Insight type | Delivery location |
|---|---|
| Dedup detection | In-app banner + push notification |
| Entry correction | Inline warning on transaction card |
| Daily nudge | Dashboard card (rotates daily) |
| Weekly snapshot | Push notification (user-configured day/time) |
| Monthly analysis | Push notification + full `/analysis` page |
| Bill due | Dashboard card (5 days before) |
| Subscription audit | `/analysis` page + optional push |
| Year in review | Push notification (Dec 31) |

### Analysis generation triggers

| Trigger | When |
|---|---|
| Manual | User taps "Generate Analysis" on `/analysis` page |
| Auto-daily | Midnight if `analysis_schedule = daily` |
| Auto-weekly | Midnight Monday (or user-configured day) |
| Auto-monthly | Midnight on the 1st of each month |
| On-demand via Shortcut | POST to `/api/analyze` from iPhone Shortcut |

### Caching behaviour

- Generated analysis cached in `analysis_cache` sheet tab
- Cached by: `period_type` + `from_date` + `to_date`
- Cache TTL: 24 hours (after which "Regenerate" is offered)
- If no new transactions since last generation → serves cache without re-running Claude
- Prompt caching (Anthropic SDK): system prompt + transaction list cached with `cache_control: ephemeral` to reduce cost on regeneration

---

*Last updated: 2026-04-26*
*Version: 1.0 — pre-implementation*
