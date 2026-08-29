# KisanPool — Design System & Screen Map

**One design system governs the entire app: the Farmer set, "Agri-Logistics Standard"** — source: `screen/stitch_kisanpool_farmer_app_ui_ux (1)/stitch_kisanpool_farmer_app_ui_ux/agri_logistics_standard/DESIGN.md`.

Every screen, component and layout in both the `(farmer)` and `(transporter)` stacks uses these tokens without exception: **Inter**, primary `#0d631b`, secondary `#2e7d32`, radii `8px` / `16px` / `24px`, `#f8faf8`–`#eceeec` surfaces, 4px spacing baseline.

> **The Transporter "Agri-Tech Premium" system is not used anywhere.** Its fonts (Manrope, Be Vietnam Pro), its colors (`#052405`, `#1b3a18`, `#3b6934`, `#012410`, `#f8faf7`) and its radius scale (16/24/32/48px) must not appear in `theme.ts`, in any component, or on any screen. The transporter export at `screen/stitch_kisanpool_transporter_app_ui_ux/agri_tech_premium/DESIGN.md` is retained only as a record of the screens' *layout and content*, never their styling. See ADR-017, which supersedes ADR-009.

The HTML exports are reference, not source: each screen is rebuilt natively in React Native from the tokens below, gathered into one `theme.ts` shared by both roles. There is no per-role theme, no theme override map, and no role-conditional styling.

---

## 1. Color

### The palette (Agri-Logistics Standard) — used app-wide, both roles

The two brand greens in product language map to these tokens: **Primary Green `#0d631b`** is the `primary` token (primary actions, active states, branding) and **Secondary Green `#2e7d32`** is the `primary-container` token (filled containers, the "Agricultural Green" brand touchpoint, primary button fill). `secondary` `#006e1c` remains a supporting interactive accent from the export and is not one of the two headline brand greens.

| Token | Value | Use |
|---|---|---|
| `primary` | `#0d631b` | Primary actions, active states, branding |
| `primary-container` | `#2e7d32` | Filled containers, the "Agricultural Green" brand touchpoint |
| `on-primary` | `#ffffff` | Text/icons on primary |
| `on-primary-container` | `#cbffc2` | Text on primary containers |
| `secondary` | `#006e1c` | Interactive accents |
| `secondary-container` | `#91f78e` | Success chips and soft highlights |
| `tertiary` | `#734e00` | Amber/gold — pending states, "Recommended" highlights |
| `tertiary-container` | `#926500` | |
| `on-tertiary-container` | `#ffefda` | |
| `error` | `#ba1a1a` | Errors, destructive actions |
| `error-container` | `#ffdad6` | Error backgrounds |
| `on-error-container` | `#93000a` | Error text |
| `surface` / `background` | `#f8faf8` | Warm-neutral page ground — not pure white, to cut outdoor glare |
| `surface-container-lowest` | `#ffffff` | Cards that need to pop off the ground |
| `surface-container-low` | `#f2f4f2` | Grouped list backgrounds |
| `surface-container` | `#eceeec` | Section fills |
| `surface-container-high` | `#e6e9e7` | Pressed / raised fills |
| `surface-container-highest` | `#e1e3e1` | Highest tonal layer |
| `surface-variant` | `#e1e3e1` | Dividers, inert fills |
| `on-surface` | `#191c1b` | Body text |
| `on-surface-variant` | `#40493d` | Secondary text |
| `outline` | `#707a6c` | Borders |
| `outline-variant` | `#bfcaba` | Hairlines |
| `inverse-surface` | `#2e3130` | Snackbars, tooltips |
| `inverse-on-surface` | `#eff1ef` | Text on inverse |
| `surface-tint` | `#1b6d24` | Elevation tint |

---

## 2. Typography

**Inter is the only font family in the app** — every screen, every role, every weight. It was chosen for bilingual legibility (English alongside Marathi/Devanagari) without visual conflict, and it carries Devanagari for the bilingual pattern below. Manrope and Be Vietnam Pro from the Transporter export are **not used anywhere** and must not be added to the bundle (ADR-017). Body text never drops below 14px on a primary reading path.

| Style | Size / weight / line-height | Use |
|---|---|---|
| `display-lg` | 32 / 700 / 40, tracking −0.02em | Screen-defining numbers and hero headings (earnings totals, final cost) |
| `headline-lg` | 24 / 600 / 32 | Screen titles |
| `headline-md` | 20 / 600 / 28 | Section headers; primary bilingual label (often Marathi) |
| `body-lg` | 16 / 400 / 24 | Default body copy |
| `body-md` | 14 / 400 / 20 | Dense list content, secondary copy |
| `label-lg` | 14 / 600 / 20, tracking 0.01em | Buttons, input labels, tabs |
| `label-sm` | 12 / 500 / 16 | Badges, metadata, timestamps |
| `bilingual-subtext` | 13 / 400 / 18 | The English line sitting directly under a Marathi `headline-md` label |

**Bilingual pattern:** primary label in the user's language as `headline-md`, English gloss immediately beneath as `bilingual-subtext`. Use it wherever a wrong tap costs money — role selection, accept/reject, payment confirmation.

---

## 3. Spacing

4px baseline grid.

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Icon-to-label, badge padding |
| `sm` | 8px | Related data inside a card |
| `gutter` | 12px | Card-internal gutter / card gap |
| `md` | 16px | Standard block spacing, card padding, screen edge margin |
| `lg` | 24px | Section breaks |
| `xl` | 32px | Major separations |

A strict **16px horizontal safe area** on every screen. Every interactive element is at least **48px** tall — these are one-handed, outdoors, sometimes-gloved taps. Primary actions sit in the **lower 40%** of the screen — a thumb-zone rule that applies to both roles, since farmers and drivers alike use the app one-handed and in transit.

---

## 4. Corner radii

One scale, app-wide. The three radii that carry the visual identity are **8px** (buttons, inputs), **16px** (cards, containers) and **24px** (banners, bottom sheets). The Premium scale (16/24/32/48px) is not used.

| Token | Value | Use |
|---|---|---|
| `sm` | 4px | Chips, small badges |
| `DEFAULT` | **8px** | Buttons, inputs — the professional base radius |
| `md` | 12px | Status badges, secondary containers |
| `lg` | **16px** | Cards and grouping containers |
| `xl` | **24px** | Dashboard banners, bottom sheets, modal sheets |
| `full` | 9999px | Pills, avatars |

---

## 5. Elevation

Tonal layering plus highly diffused, green-tinted ambient shadows — never neutral black, which reads as "dirty" against the warm ground.

| Level | Shadow | Applied to |
|---|---|---|
| 0 — Flat | none, optional 1px `outline-variant` border | Page background, inert sections |
| 1 — Subtle | `0px 4px 12px rgba(0,0,0,0.05)` | List cards: mandis, matches, available trips |
| 2 — Floating | `0px 8px 24px rgba(46,125,50,0.15)` | Active tracking card, "Track Trip" button, primary CTAs |
| Backdrop blur | used sparingly | Modal overlays and the chat sheet, to keep focus on the action |

The same three levels apply on transporter screens — the green-tinted level-2 shadow uses `rgba(46,125,50,0.15)` (secondary green) everywhere, never a forest-green tint.

---

## 6. Core components

Every component below is shared: one implementation in `apps/mobile/components/`, used unchanged by both the `(farmer)` and `(transporter)` stacks. A component must never branch on `User.role` for styling.

- **Primary button** — solid `primary-container` (`#2e7d32`), white `label-lg`, 8px radius, ≥48px tall, trailing arrow on forward actions ("Continue", "Book", "Accept Trip").
- **Secondary button** — white or light-green fill, `primary` border and text. "Call Driver", "Add to Favorites".
- **Ghost button** — no fill or border. "View All", "Cancel".
- **List card** — 16px padding, 1px `outline-variant` border, elevation 1, 16px radius; 48px leading icon/image, vertical text stack, right-aligned metric (distance, price).
- **Match card** — high-contrast header with a "Best Match" badge, then a metric grid: cost split, distance, transporter rating.
- **Status badge** — pill, 4px vertical / 8px horizontal padding, `label-sm`. In Progress = light blue on dark blue; Confirmed = light green on dark green; Arriving/Pending = light amber on dark amber; Rejected/Failed = `error-container` on `on-error-container`.
- **Input** — 1px border, 12px padding, label above the field; focused border switches to `secondary`.
- **Selection chip** — commodity filters (Onion, Tomato); toggling fills with `primary`.
- **Progress line / stepper** — 4px stroke, rounded caps, circular nodes; completed nodes filled with a checkmark, the active node pulsating, inactive in soft neutral.

Transporter-specific surfaces are built from these same primitives: the verification-status banner is a status badge inside a 24px-radius banner, the availability toggle uses `primary` for its active state, the earnings summary uses `display-lg` on a level-1 card, and "Accept Trip" is the standard primary button with its trailing arrow.

---

## 6.1 `theme.ts` — the single source in code

One theme module, imported everywhere. No second theme object, no per-role override map, no role-conditional style branches, and no raw hex literals or magic numbers in component files — if a value isn't in `theme.ts`, it doesn't go on screen.

```ts
// apps/mobile/theme.ts — shape only; values are the tables above
export const theme = {
  colors:  { primary: '#0d631b', primaryContainer: '#2e7d32', /* …§1 */ },
  font:    'Inter',                       // the only family
  type:    { displayLg, headlineLg, headlineMd, bodyLg, bodyMd, labelLg, labelSm, bilingualSubtext },
  space:   { xs: 4, sm: 8, gutter: 12, md: 16, lg: 24, xl: 32 },
  radius:  { sm: 4, DEFAULT: 8, md: 12, lg: 16, xl: 24, full: 9999 },
  elevation: { level0, level1, level2 },
} as const;
```

**Review checklist for any UI change:**

- [ ] No font other than Inter is loaded or referenced
- [ ] No color outside §1 appears in the diff — in particular none of `#052405`, `#1b3a18`, `#3b6934`, `#012410`, `#81a579`, `#b9eeab`, `#f8faf7`
- [ ] Buttons and inputs are 8px, cards 16px, banners and sheets 24px
- [ ] Interactive elements are ≥48px tall, screen edge margin is 16px
- [ ] Nothing branches on `User.role` to pick a style

---

## 7. Screen inventory

Source folders are under `screen/`. Screens marked *(new)* have no Stitch export and are designed from these tokens.

### Shared onboarding — `(auth)`

| Screen | Source folder | Route | Role | Purpose |
|---|---|---|---|---|
| Onboarding container | `f0_onboarding_auth` | `(auth)/_layout` | Both | Shared stepper shell wrapping every onboarding screen, including KYC |
| Welcome & language | `f0.1_welcome_language` | `(auth)/welcome` | Both | Language picker — sets the default Sarvam language |
| Role selection | `f0.2_role_selection` | `(auth)/role` | Both | Farmer vs Transporter; sets `User.role` permanently |
| Mobile verification | `f0.3_mobile_verification` | `(auth)/verify` | Both | Phone + 6-digit OTP |
| Farmer details | `f0.4_farmer_details` | `(auth)/farmer-details` | Farmer | Name + default pickup location via Google Places |
| Onboarding success | `f0.5_onboarding_success` | `(auth)/success` | Both | Confirmation; requests push-notification permission here |
| Vehicle registration | `onboarding_registration` | `(auth)/vehicle-register` | Transporter | Vehicle type, capacity, rate per km |
| KYC upload *(new)* | — | `(auth)/kyc` | Transporter | RC, DL, PAN + bank details; feeds Razorpay Route onboarding. Vehicle stays "Pending Verification" and cannot accept matches until approved |

### Farmer — `(farmer)`

| Screen | Source folder | Route | Purpose |
|---|---|---|---|
| Home | `f1_farmer_home` | `(farmer)/home` | Dashboard, "New Request" CTA, recent requests, Servo AI mic button |
| Mandi discovery | `f2_mandi_discovery` | `(farmer)/mandis` | Nearby mandis on a Google Map plus a list |
| Mandi details | `f3_mandi_details` | `(farmer)/mandis/[id]` | Price trend, distance, "Ship here" |
| Smart pool match | `f4_smart_pool_match` | `(farmer)/requests/[id]/matches` | Top-3 ranked matches, cost split, transporter rating badge, "Accept Match" — live-updated over the socket |
| Checkout *(new)* | — | `(farmer)/requests/[id]/checkout` | Razorpay Checkout for the farmer's share, immediately after accepting, before the booking is finalised |
| Active trip tracking | `f5_active_trip_tracking` | `(farmer)/trips/[id]` | Live map, status stepper, chat button, driver call button |
| Rate transporter *(new)* | — | `(farmer)/trips/[id]/rate` | 1–5 stars + optional comment after delivery |
| Payments passbook *(new)* | — | `(farmer)/payments` | Past payments, receipts, refund status |

### Transporter — `(transporter)`

| Screen | Source folder | Route | Purpose |
|---|---|---|---|
| Dashboard | `transporter_dashboard` | `(transporter)/home` | Availability toggle, earnings summary, socket-updated live counts, verification-status banner while pending |
| Available trips | `available_trips` | `(transporter)/trips/available` | List + mini-map of matched requests; accept or reject with a reason |
| Active trip management | `active_trip_management` | `(transporter)/trips/[id]` | Live map, status buttons, chat + call with the farmer; publishes GPS every ~5s |
| Trip completion & billing | `trip_completion_billing` | `(transporter)/trips/[id]/complete` | Mark delivered with a proof-of-delivery photo, final cost split, triggers the payout |
| Rate farmer *(new)* | — | `(transporter)/trips/[id]/rate` | 1–5 stars + optional comment after delivery |
| Payouts passbook *(new)* | — | `(transporter)/payouts` | Every payout, its Razorpay transfer status, running total |

---

## 8. Navigation map

```
app launch
   │
   ├── no valid JWT ──▶ (auth)/welcome ──▶ (auth)/role ──▶ (auth)/verify
   │                                                          │
   │                        ┌─────────────────────────────────┴────────────┐
   │                        │ role = FARMER                 role = TRANSPORTER
   │                        ▼                                     ▼
   │              (auth)/farmer-details                (auth)/vehicle-register
   │                        │                                     │
   │                        │                                (auth)/kyc
   │                        └──────────────┬──────────────────────┘
   │                                       ▼
   │                             (auth)/success   ← push permission prompt
   │                                       │
   └── valid JWT ──────────────────────────┤
                                           ▼
                        root navigator reads User.role
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
              (farmer)/home                             (transporter)/home
              ├── mandis ─▶ mandis/[id]                 ├── trips/available
              ├── requests/[id]/matches                 ├── trips/[id] ─▶ trips/[id]/complete
              │      └─▶ requests/[id]/checkout         │                       └─▶ trips/[id]/rate
              ├── trips/[id] ─▶ trips/[id]/rate         └── payouts
              └── payments
```

`(farmer)` and `(transporter)` are mutually exclusive: the root navigator mounts exactly one of them based on `User.role` after OTP verification, and there is no in-app role switch in the MVP. Both stacks share the header, the Servo AI mic button, `<TripMap />`, the socket connection and the notification prompt.

---

## 9. Interaction notes — the three complex flows

### 9.1 Checkout handoff after accepting a match

The Accept button on the match card is not a confirmation — it is a commitment to pay, and the copy must say so ("Accept & Pay ₹X"). Tapping it calls `POST /transport/requests/:id/accept`, which creates a `Payment` in `CREATED` and moves the request to `PAYMENT_PENDING`, then routes immediately to the checkout screen. That screen shows the cost breakdown one final time (total, farmer's 60% share, vehicle, transporter, distance) before calling `POST /payments/create-order` and opening the native Razorpay sheet.

Three outcomes need distinct UI: **success** — the sheet returns the signature triple, the app posts it to `/payments/verify`, and the screen holds a "Confirming your booking…" state until either the `payment:captured` socket event or a successful verify response arrives, because the webhook is what actually confirms it. **Cancel** — the farmer dismissed the sheet; the request stays in `PAYMENT_PENDING` and the screen offers "Try again" without re-accepting the match. **Race lost** — `CONCURRENT_BOOKING` came back after payment; the screen must state plainly that the vehicle was taken, that the money is being refunded automatically, and route back to the match list to pick another. Never show a generic error here — this is the one place where an unclear message costs the user real money.

### 9.2 Live map + chat during an active trip

The trip screen is a full-bleed `<TripMap />` with a bottom sheet over it. The map carries three layers: pickup and destination markers, the route polyline from the cached `/maps/directions` result, and a vehicle marker moved by each `trip:location` event — animate the marker between positions rather than snapping it, since GPS arrives roughly every 5 seconds. The sheet holds the status stepper (elevation 2, pulsating active node), the ETA from the same event, and two persistent buttons: **Chat** and **Call**. Call is a plain `tel:` link. Chat expands the sheet into a message list backed by `chat:send` / `chat:message`, with history loaded from the persisted `ChatMessage` documents so a reconnect doesn't blank the thread. When a `chat:message` arrives while the sheet is collapsed, badge the Chat button rather than interrupting the map. Status changes arrive as `trip:status` and advance the stepper; the same transitions also fire a push, so the screen must tolerate arriving already-advanced after a background stint.

### 9.3 Voice assistant round trip

The mic button lives on `(farmer)/home` (and optionally the transporter dashboard) as a floating action at elevation 2. The loop is: tap → `expo-av` records with a visible listening state → `POST /ai/stt` returns `{ transcript, language }` → the transcript is shown as the user's line so a mis-transcription is visible and correctable → `POST /ai/chat` returns `{ reply, language, action, data }` → `POST /ai/tts` returns base64 audio played through `expo-av` while the reply text is displayed → if `action` is a navigation, route there with `data` already fetched, so the destination screen never re-requests what the assistant already has.

Every state needs a visual, not just audio: idle, listening, transcribing, thinking, speaking. Before any state-changing tool the assistant states what it is about to do and waits for a clear spoken yes — the UI must show that pending confirmation as text too, so a farmer in a noisy field can read what he is agreeing to. And the flow **always stops at the checkout handoff**: the assistant may reach `acceptMatch`, then it navigates to `(farmer)/requests/[id]/checkout` and hands control back to the normal payment UI. It never collects, initiates or confirms a payment by voice.
