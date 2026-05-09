# SpendingTracker — Full Project Blueprint

> Fully agentic, AI-first personal spending tracker.
> Google Sign-In · Google Sheets as backend · PWA · Offline-first · Claude-powered

---

## Table of Contents

1. [Vision & Principles](#1-vision--principles)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Data Model (Google Sheet Structure)](#4-data-model-google-sheet-structure)
5. [Pages & Screens](#5-pages--screens)
6. [Feature Specifications](#6-feature-specifications)
7. [API Endpoints](#7-api-endpoints)
8. [AI Agent Design](#8-ai-agent-design)
9. [Offline Strategy](#9-offline-strategy)
10. [Settings Reference](#10-settings-reference)
11. [iPhone Shortcut Integration](#11-iphone-shortcut-integration)
12. [Folder Structure](#12-folder-structure)
13. [Phased Rollout](#13-phased-rollout)

---

## 1. Vision & Principles

### What this is NOT
- Not a traditional budget app where you fill spreadsheets manually
- Not a bank integration app (no Plaid, no scraping)
- Not a cloud-database SaaS

### What this IS
- An **AI agent** that lives on your phone, observes your spending as you tell it, and proactively acts
- Every input (text, photo, paste) triggers agents — extract → categorize → dedup → flag — without user prompting
- **Your data lives in your Google Sheet** — you own it, you can open it in Sheets anytime
- Region-aware intelligence: suggestions make sense for Chennai, not California

### Core Principles
- **Agent-first**: Claude does the heavy lifting; user just provides raw input and confirms
- **Offline-first**: Works without internet; syncs when back online
- **Zero lock-in**: All data in Google Sheets, exportable as CSV anytime
- **Single currency (INR) default** with multi-currency support via conversion API

---

## 2. Tech Stack

### Frontend
| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR + API routes in one, Vercel native |
| Language | TypeScript | Safety at scale |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, accessible |
| PWA | next-pwa + Workbox | Service worker, offline, installable |
| Offline DB | Dexie.js (IndexedDB wrapper) | Queue entries offline, cache reads |
| Charts | Recharts | Lightweight, composable |
| Camera | HTML5 MediaDevices API | Native, no library needed |
| State | Zustand | Simple global state |
| Forms | React Hook Form + Zod | Validation without overhead |

### Backend (Next.js API Routes)
| Concern | Choice |
|---|---|
| Auth | NextAuth.js v5 (Google provider) |
| Google Sheets | googleapis (official SDK) |
| AI | Anthropic SDK (Claude claude-sonnet-4-6) |
| Image OCR | Claude Vision (multimodal) |
| Shortcut Auth | User-specific Bearer token (JWT) |

### Infrastructure
| Concern | Choice |
|---|---|
| Hosting | Vercel (free tier → pro as needed) |
| Secrets | Vercel Environment Variables |
| Domain | Custom domain optional |

### External APIs
| API | Used for |
|---|---|
| Google OAuth 2.0 | Sign-in + Sheets/Drive access |
| Google Sheets API v4 | Read/write user's sheet |
| Google Drive API | Create sheet on first login |
| Anthropic Claude API | All AI — parse, dedup, analyze, suggest |
| `jeapis.netlify.app/currency` | Multi-currency conversion |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      PWA (Browser)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │Dashboard │  │ Capture  │  │Analysis  │  │ Settings  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │               │        │
│  ┌────▼──────────────▼──────────────▼───────────────▼────┐  │
│  │              Zustand Global Store                      │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────────┐  │
│  │          Dexie.js (IndexedDB)                          │  │
│  │  offline queue │ cached transactions │ categories      │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │ online sync                      │
└───────────────────────────┼──────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼──────────────────────────────────┐
│                  Next.js API Routes (Vercel)                  │
│                                                               │
│  /api/auth          /api/transactions     /api/analyze        │
│  /api/parse/text    /api/parse/image      /api/shortcut       │
│  /api/sheet/init    /api/user/token       /api/compare        │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ NextAuth.js │  │Anthropic SDK│  │  googleapis SDK     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                     │                  │
          ┌──────────▼──┐       ┌───────▼────────┐
          │ Claude API  │       │ Google Sheets  │
          │(claude-     │       │ (user's drive) │
          │ sonnet-4-6) │       └────────────────┘
          └─────────────┘
```

### Data flow for a new entry
```
User input (any method)
    │
    ▼
[If offline] → queue in IndexedDB → show "queued" badge
[If online]  → POST /api/parse/text or /api/parse/image
                    │
                    ▼
               Claude extracts:
               merchant, amount, date, category, items, payment_method
                    │
                    ▼
               Confirmation UI (user adjusts if needed)
                    │
                    ▼
               POST /api/transactions → write to Google Sheet row
                    │
                    ▼
               Dedup Agent runs in background:
               compare with last 90 days
                    │
                ┌───┴───┐
                │       │
           duplicate   clean
           found        │
                │        ▼
                ▼       done
           push notification + in-app flag
```

---

## 4. Data Model (Google Sheet Structure)

The app auto-creates a Google Sheet named **"SpendingTracker"** in the user's Drive on first login. It contains multiple sheets (tabs):

### Sheet: `transactions`

| Column | Type | Description |
|---|---|---|
| `id` | string | UUID v4 |
| `date` | date | YYYY-MM-DD |
| `time` | time | HH:MM |
| `amount` | number | Always in INR (or base currency) |
| `original_amount` | number | If paid in foreign currency |
| `original_currency` | string | ISO code e.g. USD |
| `merchant` | string | Shop/app/vendor name |
| `category` | string | Primary category name |
| `subcategory` | string | Sub-category name |
| `items` | string | JSON array of line items e.g. `[{"name":"Coffee","qty":1,"price":120}]` |
| `payment_method` | string | Cash / UPI / Card / NetBanking / Other |
| `tags` | string | Comma-separated tags |
| `notes` | string | Free text |
| `source` | string | manual / sms / email / receipt / shortcut |
| `raw_input` | string | Original text or image description before parsing |
| `location` | string | Optional — city or area |
| `is_duplicate` | boolean | Flagged by dedup agent |
| `duplicate_ref` | string | ID of the likely original entry |
| `created_at` | datetime | ISO timestamp |
| `updated_at` | datetime | ISO timestamp |

### Sheet: `categories`

| Column | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `name` | string | Category name |
| `parent_id` | string | Empty if top-level |
| `color` | string | Hex color |
| `icon` | string | Emoji or icon name |
| `is_default` | boolean | Default = app-provided, custom = user-added |
| `created_at` | datetime | |

**Default categories (pre-seeded):**
- Food & Dining (Restaurants, Cafes, Swiggy/Zomato, Groceries)
- Transport (Ola/Uber, Fuel, Auto, Bus/Train, Flight)
- Shopping (Clothing, Electronics, Household, Online)
- Entertainment (Movies, OTT, Events, Games)
- Health (Pharmacy, Doctor, Gym, Lab Tests)
- Bills & Utilities (Electricity, Mobile, Internet, Rent, EMI)
- Education (Books, Courses, School)
- Personal Care (Salon, Spa)
- Gifts & Donations
- Others

### Sheet: `analysis_cache`

| Column | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `period` | string | `2025-W12` / `2025-04` / `2025-04-15` |
| `period_type` | string | week / month / day |
| `summary_json` | string | Full AI analysis JSON |
| `generated_at` | datetime | |

### Sheet: `meta`

| Column | Type | Description |
|---|---|---|
| `key` | string | Setting key |
| `value` | string | Setting value |

Used to persist: `shortcut_token`, `region`, `lifestyle_tags`, `currency`, `analysis_schedule`

---

## 5. Pages & Screens

### Page Map

```
/                   → Landing (unauthenticated) / Dashboard (authenticated)
/dashboard          → Main dashboard
/add                → Add entry (manual form)
/capture            → Smart capture (camera / paste text)
/transactions       → Full transaction list
/transactions/[id]  → Single transaction detail + edit
/analysis           → AI analysis & insights
/compare            → Item price comparison across merchants
/categories         → Category management
/settings           → All settings
/settings/profile   → Profile & region
/settings/sheet     → Google Sheet info & reconnect
/settings/shortcut  → iPhone Shortcut setup & token
/settings/data      → Export, sync, cache
/onboarding         → First-time setup wizard (runs once after first login)
```

---

## 6. Feature Specifications

### 6.1 Landing Page (`/`)

**Unauthenticated state:**
- App name + tagline: "Your AI spending agent"
- Brief 3-point value proposition
- "Sign in with Google" button → triggers OAuth flow
- No data entered without sign-in

**Authenticated state:**
- Redirect to `/dashboard`

---

### 6.2 Onboarding Wizard (first login only)

Step 1 — Welcome
- Explain what the app will do (create a Google Sheet, what data it reads)
- Request Drive + Sheets permission scope explicitly

Step 2 — Sheet created
- Show the auto-created Sheet name with a link to open it in Google Sheets
- Explain user always owns and can edit this file

Step 3 — Profile basics
- Name (pre-filled from Google)
- City / Region (text field + auto-detect button)
- Lifestyle tags (multi-select chips): Vegetarian, Budget-conscious, Student, Frequent traveller, Family, etc.

Step 4 — iPhone Shortcut setup (optional, skippable)
- Display user's API token
- Link to download the Shortcut file or copy the Shortcut setup instructions
- "I'll set this up later" option

Step 5 — Done
- Quick animation, go to dashboard

---

### 6.3 Dashboard (`/dashboard`)

**Header bar:**
- App name + avatar (top right)
- Notification bell with badge count

**Period toggle:**
- Chips: Today / This Week / This Month (default: This Month)
- Custom date range picker option

**Summary cards (row of 3):**
- Total spent (period)
- Number of transactions
- Top category

**AI nudge card:**
- Single highlighted insight e.g. "You spent 40% more on food delivery this week vs last week"
- Tap to go to full analysis

**Duplicate alert banner (conditional):**
- "2 possible duplicate entries found — review"
- Tap → goes to transaction list filtered to duplicates

**Quick Add FAB:**
- Floating button (bottom right)
- Tap → bottom sheet with 3 options:
  - Manual entry
  - Camera (receipt)
  - Paste text (SMS/email)

**Recent transactions list:**
- Last 5 entries
- Each row: merchant icon + name, category chip, amount, date
- "See all" link → `/transactions`

**Spending breakdown mini-chart:**
- Donut chart of top 5 categories for the period

---

### 6.4 Add Entry — Manual (`/add`)

**Fields:**
- Amount (INR) — number keyboard, required
- Merchant / Shop name — text, required, auto-suggest from past merchants
- Date — date picker, default: today
- Time — time picker, default: now
- Category — searchable dropdown with icons, required
- Subcategory — appears after category selected
- Items (optional) — repeating field: item name + quantity + price
- Payment method — segmented: Cash / UPI / Card / NetBanking / Other
- Tags — chip input, free text
- Notes — textarea
- Location — text field, optional
- Recurring — toggle: if on, select frequency (daily/weekly/monthly)

**Behaviour:**
- Amount field validates INR format
- Save button triggers: write to sheet → dedup agent → return to dashboard
- Shows "Saving..." spinner while in flight
- If offline: shows "Saved offline — will sync when connected"

---

### 6.5 Smart Capture (`/capture`)

**Two tabs:**

**Tab 1: Camera / Receipt**
- Full-screen camera viewfinder
- Capture button → sends image to `/api/parse/image`
- Claude Vision extracts: merchant, items, amounts, total, date, payment method
- Confirmation screen: pre-filled form (same fields as /add) — user edits if needed
- "Looks wrong? Retake" option
- Gallery upload option (pick from photo library)

**Tab 2: Paste Text**
- Large textarea with placeholder: "Paste your SMS, email, or any payment notification here"
- "Parse" button → sends text to `/api/parse/text`
- Claude extracts structured data
- Same confirmation screen as above
- Character limit: 5000 chars (enough for email threads)

**Confirmation screen (shared):**
- Shows "Extracted by AI" badge
- Highlights fields Claude is uncertain about in amber
- User can edit any field before saving
- "Save Entry" → same flow as manual

---

### 6.6 Transactions (`/transactions`)

**Filter bar (collapsible):**
- Date range (presets: Today, This week, This month, Last month, Custom)
- Category (multi-select)
- Merchant (text search)
- Payment method (multi-select)
- Amount range (min / max sliders)
- Source filter (manual / sms / receipt / shortcut)
- Show duplicates only (toggle)
- Sort: Date desc (default) / Date asc / Amount desc / Amount asc / Merchant A-Z

**List view:**
- Each card: date + time, merchant name, category chip, payment method icon, amount (right-aligned)
- Duplicate flag icon (red) if flagged
- Swipe left → Delete (with undo snackbar, 5s)
- Swipe right → Quick edit (amount + category inline)
- Tap → `/transactions/[id]`

**Duplicate resolution UI (inline):**
- Yellow banner on duplicate-flagged card: "Possible duplicate of [merchant] on [date] — Keep / Remove"
- Resolving removes the flag

**Pagination:**
- Load 50 at a time, infinite scroll

---

### 6.7 Transaction Detail (`/transactions/[id]`)

- Full display of all fields
- Edit mode (pencil icon → all fields become editable)
- Delete button (confirmation dialog)
- "Raw input" expandable section (shows original SMS/email/image description)
- "AI extracted" badge if source is not manual
- Duplicate info: "This may be a duplicate of [link to other entry]"

---

### 6.8 Analysis (`/analysis`)

**Period selector:**
- Day / Week / Month / Custom
- Previous/next navigation arrows
- Specific date picker

**Generate button:**
- If no cached analysis for period → "Generate AI Analysis" button
- If cached → shows analysis with "Regenerate" option + timestamp

**Analysis sections:**

**Section 1: Summary**
- AI-written narrative paragraph (2–3 sentences) on spending pattern for the period
- Total spent, vs previous same period (% change + arrow)

**Section 2: Category breakdown**
- Horizontal bar chart (categories sorted by spend)
- Each bar: category name, amount, % of total
- Tap a bar → drill down to transactions in that category

**Section 3: Merchant breakdown**
- Top 10 merchants by spend
- Table: merchant, visits, total spent, avg per visit

**Section 4: AI Insights**
- Bulleted list (4–6 items) generated by Claude:
  - Unusual spikes ("Spent 3x on medicine this week — illness-related?")
  - Recurring subscriptions detected
  - Days of week with highest spend
  - Payment method patterns
  - Category trends vs historical

**Section 5: Reduce & Optimise (region-aware)**
- Claude suggests alternatives for the user's region/city:
  - "You spent ₹4,200 on Swiggy this month — cooking 3 meals/week at home could save ₹2,000"
  - "Bigbasket subscription plan saves ~15% vs per-order for your grocery spend level"
  - "BMTC/Metro pass vs Ola: based on your travel pattern, monthly pass saves ₹1,100"
- Each suggestion includes: estimated saving, effort level (Low/Med/High), quality impact

**Section 6: Item price comparison**
- Items detected across multiple merchants
- E.g. "Coffee: Starbucks ₹380 vs Café Coffee Day ₹180 vs local ₹60 — same caffeine, different vibes"
- Sorted by potential saving

---

### 6.9 Compare (`/compare`)

- AI-auto-detected list of items bought from multiple places
- Each item card:
  - Item name
  - Merchant comparison table (merchant, last price, times bought, avg price)
  - "Best value" badge on cheapest
  - Price trend mini-chart
- Search/filter by item name
- Tap merchant row → see all transactions for that item+merchant

---

### 6.10 Categories (`/categories`)

**Default categories list:**
- Cannot be deleted (only hidden)
- Can edit color + icon

**Custom categories:**
- Add new: name + parent (optional) + color + icon (emoji picker)
- Edit / delete custom ones
- Merge category: reassign all transactions from one category to another

---

### 6.11 Settings (`/settings`)

Grouped settings page — each group links to sub-page or expands inline.

#### Profile (`/settings/profile`)
- Display name (editable)
- Profile photo (Google avatar, non-editable)
- Region / City (text field + "Auto-detect" button)
- Lifestyle tags (multi-select chips: Vegetarian, Budget-conscious, Student, Frequent traveller, Family, Senior, Health-conscious)
- These tags are passed to Claude for contextual suggestions

#### Google Sheet (`/settings/sheet`)
- Sheet name (read-only)
- Link to open Sheet in Google Sheets (new tab)
- Last synced timestamp
- "Sync now" button
- "Reconnect Sheet" (re-auth flow if permissions were revoked)
- "Create new Sheet" (if user wants to reset — requires confirmation)

#### iPhone Shortcut (`/settings/shortcut`)
- See [Section 11 — iPhone Shortcut Integration]

#### Notifications
- Toggle: Duplicate detected (push notification)
- Toggle: Weekly summary (push notification, select day + time)
- Toggle: Monthly summary (push notification, select day of month)
- Toggle: Budget alerts (if budget feature enabled)
- "Request notification permission" button if not yet granted

#### Analysis Schedule
- Auto-analysis frequency: Off / Daily / Weekly / Monthly
- "Run analysis now" manual trigger button
- When set, runs analysis at midnight on schedule and sends push notification

#### Appearance
- Theme: System / Light / Dark
- Compact mode toggle (denser transaction list)
- Currency display: ₹ symbol (always INR primary)

#### Data
- Export: "Export as CSV" (downloads all transactions)
- "Clear local cache" (clears IndexedDB, forces fresh sheet sync)
- "Clear offline queue" (discard unsynced entries — confirmation required)
- Account: "Sign out"
- Danger zone: "Delete all data" (wipes the Google Sheet — double confirmation)

---

## 7. API Endpoints

All endpoints require session auth (NextAuth session cookie) except `/api/shortcut` which uses Bearer token.

### Auth
```
GET  /api/auth/signin         NextAuth Google OAuth flow
GET  /api/auth/callback/google
GET  /api/auth/signout
GET  /api/auth/session
```

### Sheet Management
```
POST /api/sheet/init          Create "SpendingTracker" sheet if not exists
                              Response: { sheetId, sheetUrl }

GET  /api/sheet/sync          Full sync status check
POST /api/sheet/sync          Force push offline queue
```

### Transactions
```
GET  /api/transactions        Fetch transactions
     ?from=YYYY-MM-DD
     &to=YYYY-MM-DD
     &category=Food
     &merchant=Swiggy
     &source=sms
     &duplicates_only=true
     &limit=50&offset=0

POST /api/transactions        Create new transaction
     Body: TransactionInput

PUT  /api/transactions/:id    Update transaction
     Body: Partial<TransactionInput>

DELETE /api/transactions/:id  Delete transaction

POST /api/transactions/:id/resolve-duplicate
     Body: { action: "keep" | "remove" }
```

### Parsing (AI)
```
POST /api/parse/text          Parse SMS/email text
     Body: { text: string }
     Response: { extracted: TransactionInput, confidence: number, uncertain_fields: string[] }

POST /api/parse/image         Parse receipt image
     Body: FormData { image: File }
     Response: { extracted: TransactionInput, confidence: number, uncertain_fields: string[] }
```

### Analysis
```
POST /api/analyze             Generate AI analysis for period
     Body: { period_type: "day"|"week"|"month"|"custom", from: date, to: date }
     Response: { analysis: AnalysisResult, cached: boolean }

GET  /api/compare             Get item price comparison data
     Response: { items: ItemComparison[] }
```

### User
```
GET  /api/user/token          Get/generate iPhone Shortcut token
POST /api/user/token          Rotate token (generates new one)
PUT  /api/user/profile        Update profile (region, tags, settings)
```

### iPhone Shortcut (token auth)
```
POST /api/shortcut            Parse and save entry from Shortcut
     Header: Authorization: Bearer <token>
     Body: { text: string, source: "shortcut" }
     Response: { entry: Transaction, is_duplicate: boolean }
```

---

## 8. AI Agent Design

All AI uses **Claude claude-sonnet-4-6** via the Anthropic SDK with prompt caching enabled.

### 8.1 Parse Agent (text)

**Trigger:** user pastes SMS/email text  
**System prompt context:** user's region, currency (INR), known merchants from their history  
**Task:** extract structured transaction data  
**Output schema:**
```json
{
  "merchant": "Swiggy",
  "amount": 450,
  "currency": "INR",
  "date": "2025-04-15",
  "time": "13:22",
  "category": "Food & Dining",
  "subcategory": "Food Delivery",
  "items": [{"name": "Biryani", "qty": 1, "price": 350}, {"name": "Raita", "qty": 1, "price": 100}],
  "payment_method": "UPI",
  "confidence": 0.92,
  "uncertain_fields": []
}
```

**Handles:**
- HDFC/ICICI/Axis bank SMS format
- UPI payment notifications
- Swiggy/Zomato/Amazon/Flipkart order emails
- Generic expense SMS ("You have spent INR 500 at...")
- Multi-item receipts

### 8.2 Parse Agent (image/receipt)

**Trigger:** user captures or uploads receipt photo  
**Method:** Claude Vision (base64 image input)  
**Same output schema** as text parse  
**Handles:**
- Printed receipts (restaurant, grocery, retail)
- Handwritten amounts
- QR code-based digital receipts (reads visible text)
- Partial/crumpled receipts (extracts what's readable, marks rest as uncertain)

### 8.3 Dedup Agent

**Trigger:** after every new transaction is written to the sheet  
**Input:** new transaction + last 90 days of transactions from the sheet  
**Task:** detect if new entry is likely a duplicate  
**Criteria:**
- Same merchant + same amount + within 24 hours → high confidence duplicate
- Same merchant + similar amount (±5%) + same day → medium confidence
- Same amount + same day + different merchant → low confidence
**Output:**
```json
{
  "is_duplicate": true,
  "confidence": 0.95,
  "duplicate_of_id": "uuid-xyz",
  "reason": "Same merchant (Swiggy), same amount (₹450), 12 minutes apart"
}
```
**Action:** if `is_duplicate` and `confidence > 0.7` → flag both entries + push notification

### 8.4 Analysis Agent

**Trigger:** manual "Generate Analysis" tap, or auto-schedule  
**Input:** all transactions for the period + user profile (region, lifestyle tags)  
**Task:** generate full spending analysis with regional, culturally-aware suggestions  
**Output schema:**
```json
{
  "summary": "You spent ₹12,400 this month, 18% more than last month...",
  "category_breakdown": [...],
  "merchant_breakdown": [...],
  "insights": [
    "Highest spend day: Saturday (avg ₹820/Saturday)",
    "3 active OTT subscriptions detected: Netflix, Hotstar, Prime"
  ],
  "optimisations": [
    {
      "title": "Replace food delivery 3x/week with home cooking",
      "estimated_saving": 2000,
      "effort": "medium",
      "quality_impact": "neutral",
      "detail": "Your Swiggy+Zomato spend is ₹5,200/month. Cooking at home for 3 meals/week using BigBasket basics saves ~₹2,000 with comparable nutrition."
    }
  ],
  "item_comparisons": [...]
}
```

**Region-awareness:** prompt includes city/region from profile + lifestyle tags, instructing Claude to suggest alternatives available in that region.

### 8.5 Prompt Caching Strategy

- System prompt (user profile, categories list) → cached with `cache_control: ephemeral`
- Transaction history for analysis → cached per analysis run
- Reduces cost significantly for repeated analysis runs in same session

---

## 9. Offline Strategy

### What works offline
- View cached transactions (last 30 days)
- Add entries (queued)
- View cached analysis (last run)
- Edit/delete transactions (queued)
- Browse categories

### What requires online
- AI parsing (text/image)
- Generating new analysis
- Initial sign-in
- Sheet sync

### IndexedDB Stores (Dexie.js)

```
db.transactions    — cached copy of sheet (synced on load)
db.queue           — pending writes: { type, payload, created_at, retries }
db.categories      — cached categories
db.analysis_cache  — cached analysis results
db.meta            — app metadata (last_synced, user_profile, etc.)
```

### Sync Logic

```
On app load (online):
  1. Flush pending queue items in order (retry up to 3x each)
  2. Pull latest transactions from sheet (from last_synced timestamp)
  3. Update local cache

On add entry (offline):
  1. Write to db.queue with type="CREATE"
  2. Write optimistic copy to db.transactions with id="local-uuid"
  3. Show "Saved offline" badge on entry

On add entry (online):
  1. Attempt API call
  2. On success: write to db.transactions
  3. On failure: fall back to offline queue

Service Worker (Workbox):
  - Cache strategy: StaleWhileRevalidate for GET /api/transactions
  - Background sync for POST /api/transactions (Web Background Sync API)
  - Pre-cache all static assets (JS, CSS, fonts)
  - Cache app shell for full offline load
```

---

## 10. Settings Reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `theme` | enum | system | light / dark / system |
| `region` | string | "" | City or region for AI suggestions |
| `lifestyle_tags` | string[] | [] | Context tags for AI |
| `currency_primary` | string | INR | Display currency |
| `analysis_schedule` | enum | off | off / daily / weekly / monthly |
| `analysis_day` | string | monday | Day for weekly analysis |
| `analysis_time` | string | 09:00 | Time for scheduled analysis |
| `notify_duplicates` | boolean | true | Push on duplicate detect |
| `notify_weekly` | boolean | false | Weekly summary push |
| `notify_monthly` | boolean | true | Monthly summary push |
| `compact_mode` | boolean | false | Dense list view |
| `default_period` | enum | month | day / week / month |
| `default_payment_method` | string | UPI | Pre-select on manual add |
| `shortcut_token` | string | auto | JWT for iPhone Shortcut |

---

## 11. iPhone Shortcut Integration

### Setup (`/settings/shortcut` page)
1. App generates a personal Bearer token (stored in meta sheet + session)
2. User sees: endpoint URL + token
3. Two options:
   - Copy as curl command (for testing)
   - Instructions to set up iPhone Shortcut manually

### iPhone Shortcut Flow
```
Trigger: "Share" from SMS/Mail app → select "Log Spending"
  ↓
Shortcut: Get clipboard / Get share input
  ↓
POST https://yourdomain.com/api/shortcut
Headers: Authorization: Bearer <token>
Body: { "text": "<sms or email text>" }
  ↓
Response: { entry: {...}, is_duplicate: false }
  ↓
Shortcut shows: notification "₹450 logged at Swiggy"
```

### Security
- Token is a signed JWT (HS256) containing `{ userId, purpose: "shortcut" }`
- Rate limited: 60 requests/hour per token
- Token rotation available in settings (old token immediately invalidated)
- No Google session cookie required — token is the only auth for this endpoint

---

## 12. Folder Structure

```
SpendingTracker/
├── design/
│   └── BLUEPRINT.md          ← this file
│
├── src/
│   ├── app/                  Next.js App Router
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── (app)/
│   │   │   ├── dashboard/
│   │   │   ├── add/
│   │   │   ├── capture/
│   │   │   ├── transactions/
│   │   │   │   └── [id]/
│   │   │   ├── analysis/
│   │   │   ├── compare/
│   │   │   ├── categories/
│   │   │   └── settings/
│   │   │       ├── profile/
│   │   │       ├── sheet/
│   │   │       ├── shortcut/
│   │   │       └── data/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/
│   │   │   ├── sheet/
│   │   │   ├── transactions/
│   │   │   │   └── [id]/
│   │   │   ├── parse/
│   │   │   │   ├── text/
│   │   │   │   └── image/
│   │   │   ├── analyze/
│   │   │   ├── compare/
│   │   │   ├── shortcut/
│   │   │   └── user/
│   │   ├── onboarding/
│   │   ├── layout.tsx
│   │   └── page.tsx          Landing / redirect
│   │
│   ├── components/
│   │   ├── ui/               shadcn components
│   │   ├── layout/           Navbar, BottomNav, FAB
│   │   ├── dashboard/        SummaryCards, NudgeCard, RecentList
│   │   ├── transactions/     TransactionCard, FilterBar, DuplicateAlert
│   │   ├── capture/          Camera, TextPaste, ConfirmForm
│   │   ├── analysis/         Charts, InsightsList, OptimisationCard
│   │   └── settings/         All settings sub-components
│   │
│   ├── lib/
│   │   ├── auth.ts           NextAuth config
│   │   ├── sheets.ts         Google Sheets read/write helpers
│   │   ├── ai/
│   │   │   ├── parse-text.ts
│   │   │   ├── parse-image.ts
│   │   │   ├── dedup.ts
│   │   │   └── analyze.ts
│   │   ├── db/
│   │   │   ├── dexie.ts      IndexedDB schema + instance
│   │   │   └── sync.ts       Sync logic
│   │   ├── currency.ts       Conversion API wrapper
│   │   └── utils.ts
│   │
│   ├── store/
│   │   ├── transactions.ts   Zustand store
│   │   ├── ui.ts
│   │   └── user.ts
│   │
│   ├── types/
│   │   ├── transaction.ts
│   │   ├── analysis.ts
│   │   └── user.ts
│   │
│   └── hooks/
│       ├── useOnline.ts
│       ├── useSync.ts
│       └── useNotifications.ts
│
├── public/
│   ├── manifest.json         PWA manifest
│   ├── icons/                App icons (512, 192, 96px)
│   └── sw.js                 Service worker (generated by next-pwa)
│
├── .env.local                (not committed)
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 13. Phased Rollout

### Phase 1 — Foundation (MVP)
- [ ] Google Sign-In + auto Sheet creation
- [ ] Manual entry form (full fields)
- [ ] Basic transaction list with filters
- [ ] Dashboard with summary cards
- [ ] PWA install + basic offline (cached views)
- [ ] Category management

### Phase 2 — Smart Capture
- [ ] Text paste parsing (Claude)
- [ ] Receipt camera + OCR (Claude Vision)
- [ ] Confirmation UI
- [ ] Offline queue with sync

### Phase 3 — Agents
- [ ] Dedup agent (runs after every write)
- [ ] Duplicate flag UI + resolution
- [ ] Push notifications (duplicate alerts)

### Phase 4 — Analysis
- [ ] Full AI analysis page
- [ ] Category + merchant breakdown charts
- [ ] Region-aware optimisation suggestions
- [ ] Item price comparison (Compare page)
- [ ] Scheduled auto-analysis

### Phase 5 — Integrations
- [ ] iPhone Shortcut endpoint + setup page
- [ ] Export CSV
- [ ] Multi-currency via jeapis

### Phase 6 — Polish & Public
- [ ] Onboarding wizard
- [ ] Performance optimisation (prompt caching)
- [ ] Rate limiting + abuse protection
- [ ] Multi-user hardening (each user isolated to their sheet)
- [ ] Custom domain + production deployment

---

## Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# NextAuth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# Anthropic
ANTHROPIC_API_KEY=

# JWT for iPhone Shortcut tokens
SHORTCUT_JWT_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

*Last updated: 2026-04-26*
*Version: 1.0 — pre-implementation*
