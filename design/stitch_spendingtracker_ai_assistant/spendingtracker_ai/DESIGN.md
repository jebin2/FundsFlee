---
name: SpendingTracker AI
colors:
  surface: '#fcf8ff'
  surface-dim: '#dcd8e3'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2fc'
  surface-container: '#f0ecf6'
  surface-container-high: '#eae6f1'
  surface-container-highest: '#e4e1eb'
  on-surface: '#1b1b22'
  on-surface-variant: '#464553'
  inverse-surface: '#303037'
  inverse-on-surface: '#f3eff9'
  outline: '#777584'
  outline-variant: '#c8c4d5'
  surface-tint: '#544fc0'
  primary: '#1f108e'
  on-primary: '#ffffff'
  primary-container: '#3730a3'
  on-primary-container: '#a9a7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#4648d4'
  on-secondary: '#ffffff'
  secondary-container: '#6063ee'
  on-secondary-container: '#fffbff'
  tertiary: '#162766'
  on-tertiary: '#ffffff'
  tertiary-container: '#2f3e7e'
  on-tertiary-container: '#9dacf3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3b35a7'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#dde1ff'
  tertiary-fixed-dim: '#b8c4ff'
  on-tertiary-fixed: '#001354'
  on-tertiary-fixed-variant: '#334282'
  background: '#fcf8ff'
  on-background: '#1b1b22'
  surface-variant: '#e4e1eb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-margin: 20px
  gutter-md: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The brand personality is disciplined, intelligent, and encouraging. As a personal AI spending tracker, it aims to reduce financial anxiety through clarity and proactive insights. This design system leverages a **Minimalist Modern** aesthetic with heavy **Material Design 3 (MD3)** influence. 

The UI prioritizes a "calm tech" approach—using generous white space and a soft color palette to make complex financial data feel manageable. Visual weight is used sparingly to highlight AI-driven suggestions and urgent budget alerts. The experience should feel like a premium personal assistant: unobtrusive, precise, and sophisticated.

## Colors

The color strategy centers on the deep indigo primary, which evokes trust and professional stability. The background uses a slightly tinted off-white (#F8F7FF) to reduce screen glare and provide a softer canvas than pure white.

- **Primary:** Used for key actions, active states in the bottom navigation, and primary branding elements.
- **Success/Warning/Danger:** Employed strictly for financial status indicators (e.g., "Under Budget," "Approaching Limit," "Overspent").
- **Neutral/Text:** High-contrast indigo-tinted blacks are used for headings to maintain brand cohesion, while slate greys are used for secondary body text to establish clear hierarchy.

## Typography

The design system utilizes **Inter** for its exceptional readability on mobile displays and its neutral, systematic character. 

- **Numerical Data:** For currency (₹) and transaction amounts, use "Medium" or "SemiBold" weights to ensure financial figures are the focal point of the screen.
- **Hierarchy:** Use `display-lg` for total balance overviews and `label-md` (in all-caps) for category headers or timestamp markers.
- **Line Height:** Generous line heights are maintained to ensure the interface feels "airy" and legible even when displaying long lists of transactions.

## Layout & Spacing

This design system follows a **fluid-width mobile model** optimized for a 390px width. It uses an 8px base grid system to ensure consistent vertical rhythm.

- **Margins:** A standard 20px lateral margin is applied to the main viewport to prevent content from touching the screen edges.
- **Grid:** Use a 4-column layout for dashboard widgets and card layouts.
- **Padding:** Internal card padding is set to 16px (`stack-md`) to ensure content does not feel cramped within rounded containers.

## Elevation & Depth

Depth is communicated through **Soft Ambient Shadows** rather than harsh outlines. This creates a layered, "physical" feel reminiscent of stacked paper.

- **Level 0 (Background):** The off-white base layer.
- **Level 1 (Cards):** Surface color white with a very soft, diffused shadow (Y: 4px, Blur: 12px, Opacity: 4% Indigo tint).
- **Level 2 (Floating Action Button/Modals):** A more pronounced shadow to indicate interactivity and height (Y: 8px, Blur: 20px, Opacity: 8% Indigo tint).
- **Glassmorphism:** Bottom navigation bars should use a background blur (Backdrop Filter: 15px) with 90% opacity to allow content to peek through during scrolling.

## Shapes

The shape language is friendly and approachable. Following the "Rounded" setting, the system avoids sharp corners to maintain a soft, modern aesthetic.

- **Cards & Surfaces:** Use a 16px (1rem) corner radius.
- **Buttons:** Primary buttons and the FAB use a fully pill-shaped (32px+) radius to distinguish them from informational cards.
- **Input Fields:** Use an 8px (0.5rem) radius to feel sturdy and structured.

## Components

### Bottom Navigation
A fixed bar featuring 5 icons: Home, Analytics, [Center Action], Budget, and Profile. The active state uses the Primary Indigo for the icon and a small 4px dot indicator underneath.

### Floating Action Button (FAB)
The FAB is the primary entry point for "Add Expense." It is pill-shaped, colored in Primary Indigo, and positioned in the bottom-right or centered above the navigation bar. It should include a "+" icon and optionally the label "Add".

### Spending Cards
Cards are the primary container for data. They feature no borders, a white background, and soft shadows. Headers within cards should use `title-lg`.

### Transaction Lists
Transactions are grouped by date. Each row includes a category icon (rounded circle with 10% primary tint), a title, and the currency amount in `INR (₹)`. Negative amounts use the default text color, while "income" or "refunds" use the Success Green.

### Input Fields
Forms should use "Outlined" styles but with very low-contrast borders (1px, Slate 200). On focus, the border transitions to a 2px Primary Indigo stroke.

### Progress Bars
Used for budget tracking. The track is a light grey-indigo, while the indicator uses Success, Warning, or Danger colors based on the percentage of budget consumed.