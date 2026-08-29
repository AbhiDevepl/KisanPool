---
name: Agri-Logistics Standard
colors:
  surface: '#f8faf8'
  surface-dim: '#d8dad9'
  surface-bright: '#f8faf8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f2'
  surface-container: '#eceeec'
  surface-container-high: '#e6e9e7'
  surface-container-highest: '#e1e3e1'
  on-surface: '#191c1b'
  on-surface-variant: '#40493d'
  inverse-surface: '#2e3130'
  inverse-on-surface: '#eff1ef'
  outline: '#707a6c'
  outline-variant: '#bfcaba'
  surface-tint: '#1b6d24'
  primary: '#0d631b'
  on-primary: '#ffffff'
  primary-container: '#2e7d32'
  on-primary-container: '#cbffc2'
  inverse-primary: '#88d982'
  secondary: '#006e1c'
  on-secondary: '#ffffff'
  secondary-container: '#91f78e'
  on-secondary-container: '#00731e'
  tertiary: '#734e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#926500'
  on-tertiary-container: '#ffefda'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a3f69c'
  primary-fixed-dim: '#88d982'
  on-primary-fixed: '#002204'
  on-primary-fixed-variant: '#005312'
  secondary-fixed: '#94f990'
  secondary-fixed-dim: '#78dc77'
  on-secondary-fixed: '#002204'
  on-secondary-fixed-variant: '#005313'
  tertiary-fixed: '#ffdeac'
  tertiary-fixed-dim: '#ffba38'
  on-tertiary-fixed: '#281900'
  on-tertiary-fixed-variant: '#604100'
  background: '#f8faf8'
  on-background: '#191c1b'
  surface-variant: '#e1e3e1'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  bilingual-subtext:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  edge-margin: 16px
  gutter: 12px
---

## Brand & Style

The design system is built on a foundation of **Modern Mobility** merged with **Agricultural Utility**. It prioritizes trustworthiness, efficiency, and clarity for a diverse user base of farmers and logistics providers. 

The aesthetic is **Corporate / Modern**, taking inspiration from high-end logistics applications but grounding the experience in the earthy, reliable tones of the agricultural sector. The UI evokes a sense of "Sahaj" (Simple), "Surakshit" (Secure), and "Smart" (Intelligent) through:
- **Professionalism:** Using a structured grid and crisp typography to handle complex bilingual data.
- **Approachability:** Utilizing generous whitespace and large touch targets (16px+ roundedness) to ensure the interface feels welcoming and accessible on the go.
- **Trust:** A clean, minimal execution that avoids visual clutter, focusing purely on the critical path of booking and tracking produce transport.

## Colors

The palette is anchored by **Agricultural Green**, a deep, saturated green that symbolizes growth and institutional reliability. 

- **Primary Green (#2E7D32):** Used for primary actions, active states, and branding elements to establish a strong presence.
- **Vibrant Accent (#4CAF50):** A lighter, more energetic green used for success states, highlights, and secondary visual cues to maintain a high-energy "logistics" feel.
- **Surface & Backgrounds:** The design utilizes a "warm-neutral" approach. Instead of pure white, we use `#FAFBF9` for main surfaces to reduce glare in outdoor settings, and very light green tints for grouping related information in lists or cards.
- **Semantic Tones:** Amber/Gold is used for pending states or "Recommended" highlights, while a standard system blue and red handle information and error states respectively.

## Typography

This design system uses **Inter** for its exceptional legibility and neutral character, which is essential for rendering bilingual content (English and Marathi) without visual conflict.

- **Bilingual Strategy:** Use `headline-md` for primary labels (often in Marathi) with a slightly smaller `bilingual-subtext` (in English) directly beneath to assist with role and action clarity.
- **Hierarchy:** High contrast in font weights is used to separate data (e.g., pricing, weights) from descriptive text.
- **Scale:** For mobile-first logistics, body text never drops below 14px for primary reading paths to ensure usability for users in various lighting conditions.

## Layout & Spacing

The layout follows a **Fluid Mobile Grid** philosophy designed for high-density information display.

- **Rhythm:** A 4px baseline grid ensures consistent vertical rhythm. Standard spacing for content blocks is 16px (`md`), while 24px (`lg`) is reserved for section breaks.
- **Margins:** A strict 16px horizontal safe area is maintained on all screens.
- **Card Spacing:** Elements within cards use a tighter 8px (`sm`) or 12px gutter to keep related data (like "Min Price" vs "Max Price") visually grouped.
- **Touch Targets:** All interactive elements (buttons, inputs, filters) maintain a minimum height of 48px to accommodate one-handed mobile use in the field.

## Elevation & Depth

To maintain a modern logistics feel, the system uses **Tonal Layering** combined with **Ambient Shadows**.

- **Surfaces:** Most background elements are flat or use subtle 1px borders in a soft neutral color. 
- **Elevation Levels:**
    - **Level 0 (Flat):** Main background and non-interactive sections.
    - **Level 1 (Subtle Shadow):** Primary list cards (Mandis, Transporters). Shadow is highly diffused: `0px 4px 12px rgba(0, 0, 0, 0.05)`.
    - **Level 2 (Floating):** Active tracking cards and "Track Trip" buttons. Shadow: `0px 8px 24px rgba(46, 125, 50, 0.15)` using a green-tinted shadow to reinforce the brand.
- **Backdrop Blurs:** Used sparingly in modal overlays to maintain focus on action items.

## Shapes

The shape language is defined by **Large Rounded Corners**, creating a soft, friendly, and modern aesthetic.

- **Base Components:** Buttons and Input fields use a `0.5rem` (8px) radius for a professional look.
- **Container Level (rounded-lg):** Main cards and grouping containers use a `1rem` (16px) radius.
- **Feature Level (rounded-xl):** Major dashboard banners and bottom sheet menus use a `1.5rem` (24px) radius to emphasize the "Modern Mobility" aesthetic.
- **Icons:** Should always be contained within rounded-square or circular backgrounds for consistency.

## Components

### Buttons
- **Primary:** Solid `#2E7D32` background with white text. High emphasis. Includes a trailing arrow icon for "Continue" or "Book" actions.
- **Secondary:** White or light green background with `#2E7D32` border and text. Used for "Call Driver" or "Add to Favorites."
- **Ghost:** No background or border. Used for "View All" or "Cancel" links.

### Cards (List Items)
- **Mandi/Transporter Cards:** 16px padding, 1px neutral border, and subtle shadow. Includes a 48px leading image/icon, vertical text stack for details, and a right-aligned metric (e.g., Distance or Price).
- **Match Card:** High-contrast header with "Best Match" badge, followed by a grid of key trip metrics (Cost, Distance, Rating).

### Status Badges
- Small pill-shaped containers with 4px vertical / 8px horizontal padding.
- **In Progress:** Light Blue background, dark blue text.
- **Confirmed:** Light Green background, dark green text.
- **Arriving:** Light Amber background, dark amber text.

### Inputs
- **Field:** 1px border, 12px padding. Labels are positioned above the field. 
- **Selection Chips:** Used for filtering commodities (e.g., "Onion", "Tomato"). 16px height, rounded corners, toggle state changes background to Primary Green.

### Tracking Components
- **Progress Line:** Solid green line with circular nodes. Completed steps are filled with a checkmark; the active step is pulsating.