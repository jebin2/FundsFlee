# Stitch UI Prompts — SpendingTracker

> One prompt per page/section. Use these at stitch.withgoogle.com.
> Design language: Mobile-first PWA, clean and modern, Material Design 3 influence.
> Color palette: Primary — deep indigo (#3730A3). Success — emerald green. Warning — amber. Danger — rose red. Background — off-white (#F8F7FF). Currency: INR (₹).

---

## Global Design Notes (include in every prompt or set as base style)

```
Mobile app screen, 390x844px (iPhone 14 size), light theme, clean sans-serif font.
Primary color: deep indigo. Accent: emerald green for positive, rose red for overspend.
Bottom navigation bar with 5 icons. Floating action button (FAB) bottom-right where applicable.
Rounded cards with soft drop shadows. No harsh borders. Generous white space.
```

---

## 1. Landing Page

```
Design a mobile app landing screen for a personal AI spending tracker called "SpendingTracker".

Layout (top to bottom):
- Top 40% of screen: a soft gradient background (indigo to violet), centered illustration of a phone with a glowing chart/sparkle icon — minimal, not cartoonish
- App name "SpendingTracker" in bold white below the illustration, subtitle in lighter white: "Your AI spending agent"
- Three small feature bullets below in white with icons: "Snap receipts, paste SMS" | "AI finds duplicates" | "Smart tips for your city"
- Bottom 30%: white rounded card anchored to the bottom with:
  - A "Sign in with Google" button (white button with Google logo, full-width, rounded pill shape)
  - Small grey caption below: "Your data stays in your Google Sheet"
- No header bar, status bar at top in white
```

---

## 2. Onboarding — Step 1: Welcome

```
Design a mobile onboarding screen, Step 1 of 4, for a spending tracker app.

Layout:
- Top: progress dots (4 dots, first filled in indigo, rest empty grey) centered
- Large friendly illustration in the center: a Google Sheets icon with a sparkle/AI star overlay — conveying "your data, AI-powered"
- Heading (bold, large): "Your money, your sheet"
- Body text (2 lines, grey): "SpendingTracker saves everything to a Google Sheet in your Drive. You own it. We just make it smart."
- Bullet list with checkmarks (indigo):
  ✓ We'll create one Sheet in your Google Drive
  ✓ We only read/write your SpendingTracker sheet
  ✓ You can open it in Google Sheets anytime
- Bottom: full-width indigo pill button "Continue" and a small grey link "How does this work?"
```

---

## 3. Onboarding — Step 2: Sheet Created

```
Design a mobile onboarding screen, Step 2 of 4, for a spending tracker app.

Layout:
- Progress dots: 2 of 4 filled
- Large success animation placeholder (green checkmark inside a sheet icon)
- Heading: "Your sheet is ready!"
- Card in the center (white, rounded, with a subtle border):
  - Row with Google Sheets icon + sheet name "SpendingTracker — Jebin" in bold + small grey "Created just now"
  - Tappable link row: "Open in Google Sheets →" in indigo
- Body text below card (grey, small): "This sheet has 3 tabs: transactions, categories, and settings. Don't delete it — the app reads from here."
- Bottom: full-width indigo pill button "Looks good, continue"
```

---

## 4. Onboarding — Step 3: Profile Setup

```
Design a mobile onboarding screen, Step 3 of 4, for a spending tracker app.

Layout:
- Progress dots: 3 of 4 filled
- Heading: "Tell us a bit about you"
- Subheading (grey): "This helps the AI give you tips that actually make sense for where you live"
- Form fields (rounded, floating label style):
  - Name field (pre-filled: "Jebin Einstein")
  - City / Region field with a small "Auto-detect 📍" button on the right (in indigo, tappable)
- Section label "Your lifestyle" (small caps, grey)
- Multi-select chip grid (2 columns, chips with rounded corners, indigo when selected, grey outline when not):
  Vegetarian | Budget-conscious | Student | Frequent traveller | Family | Health-conscious | Senior | Night owl
- Bottom: full-width indigo pill button "Save & Continue"
- Skip link in grey below button: "Skip for now"
```

---

## 5. Onboarding — Step 4: iPhone Shortcut Setup

```
Design a mobile onboarding screen, Step 4 of 4, for a spending tracker app.

Layout:
- Progress dots: 4 of 4 filled
- Heading: "Auto-log from iPhone"
- Subheading (grey): "Set up once. Share any SMS or email to auto-log a transaction."
- Illustration: phone showing an iPhone share sheet with "Log Spending" option highlighted
- Code block style card (dark background, monospace font, rounded corners):
  Shows a masked API token:  "sk-••••••••••••••••••••••••3f9a"
  Below it: two icon buttons — "Copy token" and "Regenerate"
- Step list (numbered, grey):
  1. Download the Shortcut from the link below
  2. Paste your token when prompted
  3. Share any SMS → tap "Log Spending"
- Two buttons stacked:
  - Primary indigo pill: "Download Shortcut"
  - Ghost/outline button: "I'll do this later"
- Confetti or celebration graphic subtly in background (muted, not distracting)
```

---

## 6. Dashboard

```
Design a mobile dashboard screen for a personal AI spending tracker app.

Top section:
- Status bar (light)
- Header row: "Hi, Jebin 👋" on the left (bold), avatar circle (user photo) on the right with a notification bell icon showing a red badge "2"
- Period toggle chips below header: "Today" | "This Week" | "This Month" (This Month selected, indigo background, others grey)

Summary cards (horizontal scroll row, 3 cards):
- Card 1 (indigo background, white text): "Total Spent" — ₹14,200 (large bold) — "↑ 22% vs last month" (small amber text)
- Card 2 (white, indigo text): "Transactions" — 67 (large bold) — "This month"
- Card 3 (white, indigo text): "Top Category" — 🍕 Food & Dining — "₹5,800"

AI Nudge card (below the summary cards):
- White rounded card with a subtle indigo left border
- Small "AI Insight" label in indigo (tiny, pill badge)
- Text: "You spent 40% more on food delivery this week vs last week."
- "See full analysis →" link in indigo
- Sparkle ✨ icon on the left of the card

Duplicate alert banner (amber background, rounded card):
- ⚠️ icon + "2 possible duplicate entries found"
- "Review →" link on the right in amber-dark

Recent Transactions heading with "See all →" link on the right

Transaction list (last 5 entries, each row):
- Row 1: Swiggy icon/emoji | "Swiggy" | "Food Delivery" chip (green) | "₹450" right-aligned | "Today, 1:22 PM" grey
- Row 2: Amazon logo | "Amazon" | "Shopping" chip (blue) | "₹1,299" | "Yesterday"
- Row 3: Ola icon | "Ola" | "Transport" chip (orange) | "₹180" | "Yesterday" + red ⚠️ duplicate icon
- Row 4: Big Basket | "Big Basket" | "Groceries" chip | "₹2,340" | "Mon, Apr 21"
- Row 5: Netflix | "Netflix" | "Subscription" chip (purple) | "₹649" | "Mon, Apr 21"

Bottom: standard bottom navigation bar (5 icons: Home selected, Transactions, Add, Analysis, Settings). FAB button bottom-right with a "+" icon in indigo.
```

---

## 7. FAB Quick-Add Bottom Sheet

```
Design a mobile bottom sheet overlay that appears when the FAB "+" is tapped on the dashboard.

The background (dashboard) is dimmed/blurred.

Bottom sheet (white, rounded top corners, slides up from bottom):
- Handle bar at top center (grey pill)
- Sheet title: "Add Spending" (bold, centered)
- Three large tappable option rows with generous padding:
  Row 1: ✏️ icon (indigo circle bg) | "Enter manually" | "Type in the details" (grey subtitle) | chevron right
  Row 2: 📷 icon (indigo circle bg) | "Capture receipt" | "Photo or gallery" (grey subtitle) | chevron right
  Row 3: 📋 icon (indigo circle bg) | "Paste SMS / Email" | "Any payment notification" (grey subtitle) | chevron right
- Small grey text at bottom: "Or set up auto-log from iPhone →"
```

---

## 8. Add Entry — Manual Form

```
Design a mobile form screen for manually adding a spending entry.

Header: back arrow left, title "Add Entry" centered, "Save" text button right (in indigo, disabled/grey until amount is filled).

Form (scrollable, generous field spacing):

Section 1 — Amount:
- Large centered amount display: "₹" + big number input "0" (like a calculator display, not a regular text field)
- Numpad or keyboard auto-shows

Section 2 — Details (white card, rounded):
- "Merchant / Shop" field with store icon — placeholder "e.g. Swiggy, Big Bazaar"
- "Date" field showing "Today, Apr 26" with calendar icon (tappable)
- "Time" field showing "2:45 PM" with clock icon
- "Category" field with indigo tag icon — shows "Food & Dining 🍕" (pre-selected, tappable to change)
- "Subcategory" field — "Food Delivery" (appears after category is selected)
- "Payment Method" — segmented buttons: Cash | UPI ✓ | Card | Other (UPI selected in indigo)

Section 3 — Optional (white card, rounded, collapsed with "More details +" toggle):
- "Tags" chip input field — placeholder "e.g. work, travel"
- "Notes" textarea — placeholder "Any note..."
- "Location" field with pin icon
- "Recurring" toggle switch

Bottom: sticky "Save Entry" full-width indigo pill button above keyboard
```

---

## 9. Smart Capture — Paste Text Tab

```
Design a mobile screen for pasting SMS or email text to auto-extract a spending entry.

Header: back arrow, "Smart Capture" title, no right action.

Tab bar below header: "📷 Camera" | "📋 Paste Text" (Paste Text tab selected, indigo underline).

Main area:
- Label above textarea: "Paste any SMS, bank alert, or email below"
- Large rounded textarea (full width, ~8 lines tall, grey background, monospace font):
  Shows example placeholder text in light grey:
  "Dear Customer, Rs.450.00 has been debited from your A/c XX4521 on 26-04-25 for UPI transfer to SWIGGY. Avl Bal Rs.12,430."
- Character count bottom-right of textarea: "0 / 5000"

Below textarea:
- "Parse with AI" — full-width indigo pill button with ✨ sparkle icon
- Small grey note: "Processed securely — raw text is not stored"

Tip card below (light indigo tint, rounded):
  💡 "Works with: HDFC/ICICI/Axis SMS, Swiggy & Zomato emails, Amazon order confirmations, UPI alerts"
```

---

## 10. Smart Capture — AI Confirmation Screen

```
Design a mobile screen shown after AI parses a pasted SMS, for the user to confirm before saving.

Header: back arrow, "Confirm Entry" title, no right action.

Source badge at top: small pill badge "✨ Extracted by AI" in indigo, centered.

Extracted entry card (white, rounded, elevated shadow):
- Each field shown as a read-only row with an edit pencil icon on the right:
  - 💰 Amount: ₹450 (large, bold, indigo)
  - 🏪 Merchant: Swiggy
  - 📅 Date: Apr 26, 2025 · 1:22 PM
  - 🏷️ Category: Food & Dining → Food Delivery (chip in green)
  - 💳 Payment: UPI
  - 📦 Items: "Chicken Biryani ×1 — ₹350, Raita ×1 — ₹100" (expandable)
- One field highlighted in amber (uncertain): "Date" with amber outline and small amber text "Not sure — please verify"

Raw input expandable section (collapsed by default):
- Grey toggle row "View original SMS →"

Confidence indicator:
- "AI confidence: 92%" with a thin indigo progress bar

Bottom two buttons stacked:
- Primary: "Save Entry" — full-width indigo pill
- Secondary: "Edit details" — ghost/outline indigo pill
```

---

## 11. Smart Capture — Camera Tab

```
Design a mobile screen for capturing a receipt using the camera.

Header: back arrow, "Smart Capture" title.
Tab bar: "📷 Camera" (selected, indigo underline) | "📋 Paste Text".

Main area: full-screen dark camera viewfinder (takes up most of the screen):
- Overlay: white rounded rectangle guide frame in center with corner markers — "Align receipt here"
- Top-right of viewfinder: flash toggle icon (white)
- Small grey text below guide frame: "Hold steady — capture the full receipt"

Bottom of viewfinder (semi-transparent dark strip):
- Left: gallery icon (opens photo picker)
- Center: large white circular capture button (with thin indigo ring)
- Right: camera flip icon

Below camera area (white background strip):
- Small tip: "📋 Tip: Ensure the total amount and merchant name are visible"
```

---

## 12. Transactions List

```
Design a mobile transactions list screen for a spending tracker.

Header: "Transactions" title centered, filter icon (sliders) on the right.

Search bar below header: rounded search field, placeholder "Search merchant, category..."

Active filter chips (horizontal scroll, shown when filters applied):
- "This Month ×" (indigo filled chip) | "Food & Dining ×" (indigo filled chip) | "+ Add filter" (grey outline chip)

List grouped by date:

Date group header: "Today — ₹630" (bold date left, total right in grey)
- Transaction card 1: Swiggy emoji | "Swiggy" bold | "Food Delivery" green chip | "₹450" right bold | "1:22 PM" grey small | red ⚠️ icon (duplicate flag)
- Transaction card 2: ☕ | "Blue Tokai" | "Cafes" green chip | "₹180" | "11:05 AM"

Date group header: "Yesterday — ₹1,479"
- Transaction card 3: 🛒 | "Big Basket" | "Groceries" teal chip | "₹1,299" | "6:30 PM"
- Transaction card 4: 🚗 | "Ola" | "Transport" orange chip | "₹180" | "9:15 AM"

Date group header: "Mon, Apr 21 — ₹2,989"
- Transaction card 5: 📺 | "Netflix" | "Subscription" purple chip | "₹649" | "Auto-debit"
- Transaction card 6: 💊 | "Apollo Pharmacy" | "Health" rose chip | "₹340" | "4:00 PM"
- Transaction card 7: 🛵 | "Zomato" | "Food Delivery" green chip | "₹520" | "8:45 PM" + ⚠️ duplicate

Duplicate-flagged card (card 1 / 7): entire card has a subtle amber left border. Inline below the card: amber strip — "⚠️ Possible duplicate of Swiggy Apr 26 ₹450 — Keep both / Remove this"

Bottom: standard bottom navigation bar (Transactions tab selected).
```

---

## 13. Transaction Detail & Edit

```
Design a mobile transaction detail screen for a spending tracker.

Header: back arrow, "Transaction" title, edit pencil icon right + three-dot menu.

Top hero section (indigo gradient card, rounded bottom corners):
- Merchant emoji/logo large centered: 🛒
- Merchant name large bold white: "Big Basket"
- Amount large bold white: "₹2,340"
- Category chip white outline: "Groceries"
- Date + time grey-white: "Mon, Apr 21 · 6:30 PM"

Detail section (white card, rounded):
Rows (label left grey, value right dark):
- Payment method: UPI
- Source: Manual entry
- Tags: grocery, weekly
- Notes: "Monthly vegetables + pantry restock"
- Location: —

Items section (if present, expandable):
- "Items (6) ▼" toggle row
- Expandable list:
  Amul Milk 1L ×2 — ₹136
  Tomatoes 500g ×1 — ₹45
  Onions 1kg ×1 — ₹38
  (+ 3 more)

Raw input section (collapsed):
- "View original input ▼" (grey toggle, for SMS/email sourced entries)

Danger zone (bottom, separated):
- Red outline "Delete transaction" button (full width)
```

---

## 14. Analysis — Main Page

```
Design a mobile AI analysis screen for a spending tracker app.

Header: "Analysis" title, calendar icon right (period picker).

Period selector row: "◀" left arrow | "April 2025" bold centered | "▶" right arrow.
Below: period type chip row — Day | Week | Month ✓ | Custom (Month selected).

If analysis exists — show full analysis. If not:
- Empty state card: ✨ icon, "No analysis yet for April", indigo "Generate Analysis" button.

Assume analysis is generated. Show:

Section 1 — Summary card (indigo gradient, rounded):
- "April 2025" small white label
- "₹14,200" large bold white (total spend)
- "↑ 22% vs March" amber pill badge
- Two sub-stats row (white, smaller): "67 transactions" | "₹473/day avg"
- 3-line AI narrative in white (slightly smaller): "April was a busy month — food delivery and a dental visit drove most of the increase. Utilities were lower. Overall reasonable."

Section 2 — Category breakdown:
- Section title "Where it went" with bar chart icon
- Horizontal bar chart (5 bars):
  🍕 Food & Dining — ₹5,800 — 41% (indigo bar, full)
  🛒 Groceries — ₹3,200 — 23% (indigo, shorter)
  🏥 Health — ₹2,400 — 17% (indigo)
  🚗 Transport — ₹1,400 — 10%
  📺 Subscriptions — ₹1,200 — 8%
- Each bar is tappable

Section 3 — AI Insights (scrollable chips / cards):
- Section title "What the AI noticed" with sparkle icon
- 4 insight cards (white, horizontal scroll or stacked):
  Card 1: "🌙 38% of food orders placed after 9 PM"
  Card 2: "📺 3 OTT subscriptions — ₹1,247/month"
  Card 3: "📈 Swiggy spend up 55% vs March"
  Card 4: "💸 Top 3 merchants = 68% of spend"

Section 4 — Optimise button row:
- "💡 See saving suggestions" — indigo full-width outlined button

Bottom: standard navigation bar (Analysis tab selected).
```

---

## 15. Analysis — Optimisation Suggestions

```
Design a mobile screen showing AI spending optimisation suggestions for an Indian user.

Header: back arrow, "Saving Suggestions" title, ✨ sparkle icon right.

Intro card (light indigo tint, rounded):
- "Based on your April spending in Chennai"
- "Estimated total saving: ₹4,200–₹5,800/month"

Suggestion cards (scrollable list, white, rounded, soft shadow):

Card 1:
- Tag chip top-left: "Food Delivery" (green)
- Effort badge top-right: "Medium effort"
- Title (bold): "Replace 8 delivery orders with home cooking"
- Body (grey, 2 lines): "Your Swiggy+Zomato spend is ₹5,800/month. Cooking at home for weekday lunches saves ~₹2,800."
- Savings pill (green background): "Save ₹2,800/month"
- Quality line (small grey): "Quality: Neutral — comparable nutrition"
- Expandable "How to start ▼"

Card 2:
- Tag: "Transport" (orange)
- Effort: "Low effort"
- Title: "Metro + occasional Ola vs full Ola"
- Body: "Your ride pattern shows 60% on Metro-connected routes. Monthly pass + Ola for the rest saves ~₹1,100."
- Savings pill: "Save ₹1,100/month"
- Quality: "Neutral — same commute time roughly"

Card 3:
- Tag: "Subscriptions" (purple)
- Effort: "Low effort"
- Title: "Pause Hotstar — IPL season is over"
- Body: "You have Netflix + Hotstar + Prime. Hotstar pause for 3 months = ₹900 saved."
- Savings pill: "Save ₹900 now"

Card 4:
- Tag: "Groceries" (teal)
- Effort: "Low effort"
- Title: "BigBasket subscription vs per-order"
- Body: "At your grocery volume, BigBasket Smart Basket saves 12–15% vs individual orders."
- Savings pill: "Save ₹400–500/month"

Bottom sticky: "Total if you act on all: up to ₹5,300/month saved"
```

---

## 16. Compare — Item Price Comparison

```
Design a mobile item price comparison screen for a spending tracker.

Header: back arrow, "Price Compare" title, search icon right.

Intro subtext (grey, small): "Items you've bought from multiple places — ranked by potential saving."

Item card 1 (white, rounded, elevated):
- Item name bold: "Chicken Biryani (1 portion)"
- Merchant comparison table:
  | Merchant | Last Price | Times Bought | Avg |
  | Swiggy (Behrouz) | ₹480 | 6x | ₹480 |
  | Zomato (Paradise) | ₹340 | 3x | ₹330 | ← "Best value" green badge |
  | Local Mess | ₹120 | 2x | ₹115 |
- Savings callout (green chip): "₹360 saved/month if you swap to local"

Item card 2:
- Item name: "Amul Full Cream Milk 1L"
  | Blinkit | ₹72 | 12x |
  | Big Basket | ₹68 | 8x | ← Best value badge |
  | Local dairy | ₹60 | 4x |
- Savings callout: "₹144 saved/month at local dairy"

Item card 3:
- Item name: "Coffee (single cup)"
  | Starbucks | ₹380 | 4x |
  | Blue Tokai | ₹220 | 5x | ← Best value
  | Local filter coffee | ₹30 | 3x |

Search bar at top: "Search an item..."

Bottom: navigation bar (Analysis tab highlighted — Compare is sub-section of Analysis).
```

---

## 17. Categories Management

```
Design a mobile categories management screen for a spending tracker.

Header: "Categories" title, "+ Add" button top right (indigo text).

Section: "Default Categories" (grey section label)
List of default categories (each row, non-deletable):
- Row: 🍕 "Food & Dining" | indigo dot (color) | 5 subcategories | chevron right
- Row: 🚗 "Transport" | orange dot | 4 subcategories | chevron right
- Row: 🛒 "Groceries" | teal dot | 2 subcategories | chevron right
- Row: 🏥 "Health" | rose dot | 3 subcategories | chevron right
- Row: 📺 "Subscriptions" | purple dot | — | chevron right
- Row: 🎉 "Entertainment" | yellow dot | 3 subcategories | chevron right
- Row: 💡 "Bills & Utilities" | grey dot | 4 subcategories | chevron right
- Row: 🎁 "Gifts" | pink dot | — | chevron right
- Row: 🔵 "Others" | blue dot | — | chevron right

Section: "My Categories" (grey section label)
- Row: 🏋️ "Gym & Fitness" | green dot | 1 subcategory | pencil icon | trash icon
- "+ Add custom category" row (dashed border, indigo text, centered)

Bottom sheet (shown when a category row is tapped):
- Category icon (large emoji, editable)
- Name field: "Food & Dining"
- Color picker: row of 8 color circles
- Subcategories list with "+ Add subcategory" option
- If custom: "Merge into another category" option + "Delete" red option
```

---

## 18. Settings — Main Page

```
Design a mobile settings main screen for a spending tracker app.

Header: "Settings" title, no actions.

User profile card at top (white, rounded, tap to go to profile settings):
- Left: user avatar circle (photo)
- Center: "Jebin Einstein" bold | "Chennai, India" grey | "Vegetarian · Budget-conscious" small chips
- Right: pencil/edit icon

Settings groups (each group is a white rounded card):

Group 1 — Account & Data:
- Row: 🗂️ "Google Sheet" | "SpendingTracker · Last synced 2m ago" grey | chevron
- Row: 📱 "iPhone Shortcut" | "Connected" green dot | chevron
- Row: 📤 "Export Data" | "CSV download" grey | chevron

Group 2 — AI & Analysis:
- Row: ✨ "Analysis Schedule" | "Monthly" grey | chevron
- Row: 🔔 "Notifications" | "3 active" grey | chevron

Group 3 — Appearance:
- Row: 🌙 "Theme" | "System" grey | chevron
- Row: 📐 "Compact Mode" | toggle switch (off)

Group 4 — Danger Zone (red tint group):
- Row: 🗑️ "Clear local cache" | red text
- Row: ⚠️ "Delete all data" | red text

Bottom: "Sign out" — centered text button, red, below all groups. Version number tiny grey at bottom "v1.0.0".
```

---

## 19. Settings — Profile

```
Design a mobile profile settings screen for a spending tracker.

Header: back arrow, "Profile" title, "Save" indigo text button right.

Avatar section (centered, top):
- Large circle avatar (user photo from Google)
- Small grey text below: "Photo from your Google account"

Form fields (white card, rounded):
- "Display name" field — "Jebin Einstein" (editable)
- "Email" field — "jebineinstein@gmail.com" (grey, read-only with lock icon)

Section: "Your location" (grey label)
White card:
- "City / Region" field — "Chennai, Tamil Nadu"
- "Auto-detect" button row below — with location pin icon (indigo, tappable), "Updates your city for AI suggestions"

Section: "Lifestyle tags" (grey label)
White card:
- Explanation text (small grey): "These help the AI give you relevant tips"
- Multi-select chip grid (4 chips per row):
  ✓ Vegetarian (indigo, selected) | ✓ Budget-conscious (selected) | Student | Frequent traveller | Family | Health-conscious | Senior | Night owl | Working professional
  (checked ones shown with ✓ and indigo fill)

Section: "Income (optional)" (grey label)
White card:
- "Monthly income" field — placeholder "₹ — helps estimate savings rate"
- Small grey note: "Stored only on your device"
```

---

## 20. Settings — Google Sheet

```
Design a mobile Google Sheet settings screen for a spending tracker.

Header: back arrow, "Google Sheet" title.

Sheet info card (white, rounded, prominent):
- Google Sheets icon (large, left)
- "SpendingTracker — Jebin" bold
- "Created Apr 26, 2025" grey small
- Green dot + "Connected" status
- "Open in Google Sheets ↗" — indigo tappable link row

Sync status card (white, rounded):
- Row: "Last synced" label | "2 minutes ago" grey right
- Row: "Pending entries" | "0 offline entries" grey right
- "Sync Now" — full-width indigo outlined button

Sheet details expandable (grey toggle "Sheet structure ▼"):
- Shows: 3 tabs — transactions (248 rows) | categories (16 rows) | meta
- "View raw data in Sheets ↗"

Danger zone (white card, red tint):
- "Reconnect Sheet" row — for if permissions were revoked (orange warning)
- "Create new Sheet" row — resets all data (red, requires confirmation dialog)
- Warning text (small grey): "Creating a new sheet permanently moves your data to a new file."
```

---

## 21. Settings — iPhone Shortcut

```
Design a mobile iPhone Shortcut setup screen for a spending tracker.

Header: back arrow, "iPhone Shortcut" title.

Status: green pill badge "Connected & working" centered below header.

How it works card (light indigo tint, rounded):
- 3 step visual flow (horizontal):
  📱 "Get an SMS" → Share icon "Tap Share" → ✨ "Auto-logged"
- Small grey text: "Share any SMS or email notification — the app parses and saves it automatically"

API Token card (white, rounded):
- Label: "Your personal token" (small grey)
- Token display: dark code-style box, monospace, masked: "sk-••••••••••••••••••••••3f9a"
- Two icon buttons below the box side by side: "👁️ Show" | "📋 Copy"
- "Regenerate token" — small red text link (with warning: invalidates old token)

Setup instructions card (white, rounded):
- Steps numbered:
  1. Download the Shortcut (button: "Download Shortcut" — indigo pill)
  2. When prompted, paste your token above
  3. Open any SMS app, tap Share → "Log Spending"
- "Test it now" — ghost button below

Test result banner (green, shown after test): "✓ Test successful — ₹450 at Swiggy logged"
```

---

## 22. Notification / Duplicate Alert Screen

```
Design a mobile screen showing a duplicate transaction alert and resolution UI.

Header: "Review Duplicates" title, back arrow left.

Intro text (amber tint card, rounded):
⚠️ "The AI found 2 entries that might be the same transaction. Review and decide which to keep."

Duplicate pair card (white, elevated, rounded):
- Label: "Pair 1 of 2" (small grey, top right)
- AI confidence badge: "95% likely duplicate" (amber pill)
- Reason text (italic grey small): "Same merchant (Swiggy), same amount (₹450), 12 minutes apart"

Two transaction tiles side by side (or stacked on narrow screens):
  Tile A (left):
  - "Entry A" label (small grey)
  - Source badge: "From SMS" (blue)
  - Swiggy · ₹450
  - Apr 26 · 1:10 PM
  - UPI

  Tile B (right):
  - "Entry B" label
  - Source badge: "Manual" (grey)
  - Swiggy · ₹450
  - Apr 26 · 1:22 PM
  - UPI

Three action buttons below the pair:
- "Keep A, remove B" — indigo outlined button
- "Keep B, remove A" — indigo outlined button
- "Keep both" — grey text button

Progress indicator at bottom: "1 of 2 pairs reviewed"
```

---

## 23. Empty States

### Empty Transactions
```
Design a mobile empty state screen for the transactions list.

Centered vertically:
- Illustration: a simple receipt with a sparkle icon, muted colors
- Heading: "No transactions yet"
- Body (grey): "Add your first entry manually, snap a receipt, or paste an SMS."
- Two buttons stacked:
  - Primary indigo pill: "Add manually"
  - Ghost indigo pill: "Paste SMS or receipt"
```

### Empty Analysis
```
Design a mobile empty state for the analysis page when no analysis has been run yet.

Centered vertically:
- Illustration: a brain with chart lines coming out, indigo tones, minimal
- Heading: "No analysis for this period"
- Body (grey): "The AI needs at least a few transactions to generate insights."
- Button: "Generate Analysis" — indigo pill (with sparkle ✨ icon)
- Small grey text below: "Takes ~10 seconds"
```

---

*Last updated: 2026-04-26*
*Version: 1.0 — pre-implementation*
