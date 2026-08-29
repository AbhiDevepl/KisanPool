---
name: Agri-Tech Premium
colors:
  surface: '#f8faf7'
  surface-dim: '#d8dbd8'
  surface-bright: '#f8faf7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f1'
  surface-container: '#eceeeb'
  surface-container-high: '#e7e9e6'
  surface-container-highest: '#e1e3e0'
  on-surface: '#191c1b'
  on-surface-variant: '#434840'
  inverse-surface: '#2e312f'
  inverse-on-surface: '#eff1ee'
  outline: '#73796f'
  outline-variant: '#c3c8bd'
  surface-tint: '#466640'
  primary: '#052405'
  on-primary: '#ffffff'
  primary-container: '#1b3a18'
  on-primary-container: '#81a579'
  inverse-primary: '#abd1a1'
  secondary: '#3b6934'
  on-secondary: '#ffffff'
  secondary-container: '#b9eeab'
  on-secondary-container: '#3f6d38'
  tertiary: '#012410'
  on-tertiary: '#ffffff'
  tertiary-container: '#183a24'
  on-tertiary-container: '#80a488'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c7edbc'
  primary-fixed-dim: '#abd1a1'
  on-primary-fixed: '#032104'
  on-primary-fixed-variant: '#2e4e2a'
  secondary-fixed: '#bcf0ae'
  secondary-fixed-dim: '#a1d494'
  on-secondary-fixed: '#002201'
  on-secondary-fixed-variant: '#23501e'
  tertiary-fixed: '#c5eccc'
  tertiary-fixed-dim: '#aad0b1'
  on-tertiary-fixed: '#00210e'
  on-tertiary-fixed-variant: '#2c4e36'
  background: '#f8faf7'
  on-background: '#191c1b'
  surface-variant: '#e1e3e0'
typography:
  headline-xl:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  container-padding: 16px
  card-gap: 12px
---

## Brand & Style

The brand personality is rooted in **Operational Excellence** and **Premium Utility**. It bridges the gap between rugged agricultural logistics and modern digital efficiency. The UI is designed to evoke a sense of deep trust, reliability, and growth, specifically catering to transporters who require immediate clarity during high-stakes logistical tasks.

The design style follows a **Premium Corporate Modern** approach. It utilizes expansive whitespace to reduce cognitive load, high-polish rounded components to signify a modern technological layer, and a color story that reflects the vitality of the Indian agricultural landscape. The aesthetic is "Clean-Field"—mimicking the organized rows of a well-tended farm, where every element has a dedicated place and purpose.

## Colors

The palette is anchored by a deep **Forest Green (#1B3A18)**, providing a sophisticated and stable foundation for the brand. This is supported by a more vibrant **Agricultural Green (#2D5A27)** used for primary actions and key brand touchpoints.

- **Primary:** Deep Forest Green for high-contrast text, headers, and primary buttons.
- **Secondary:** Agricultural Green for interactive elements and brand accents.
- **Tertiary:** Sage Green for secondary buttons, progress bars, and soft highlights.
- **Surfaces:** A warm-white neutral base (#F8FAF7) reduces eye strain and provides a premium "paper-like" feel, distinguishing the product from generic digital tools.

## Typography

This design system uses a dual-font strategy to balance professional authority with approachability. 

**Manrope** is used for all headlines and numerical data (earnings, trip IDs, weights). Its geometric clarity ensures that critical metrics are legible even in low-light outdoor environments. 

**Be Vietnam Pro** is used for all body copy and instructional text. Its slightly wider apertures and contemporary letterforms provide a friendly, human-centric experience for drivers and vehicle owners. 

For mobile efficiency, font sizes scale down conservatively to ensure that hierarchy is maintained without sacrificing legibility for the target demographic.

## Layout & Spacing

The layout philosophy is **Mobile-First and Density-Aware**. It uses a fluid grid system optimized for one-handed operation. 

- **Safe Margins:** A 16px standard margin (container-padding) ensures content is centered and away from screen edges.
- **Vertical Rhythm:** A strict 8px base unit is used to define the relationship between elements. 
- **Information Clusters:** Related data points (e.g., Trip ID and Support button) are grouped with 8px (sm) spacing, while distinct sections are separated by 24px (lg) to provide clear visual breaks.
- **Thumb Zone:** Primary actions are always located in the lower 40% of the screen to accommodate drivers using the device in transit environments.

## Elevation & Depth

Visual hierarchy is achieved through a combination of **Tonal Layering** and **Ambient Shadows**.

1.  **Base Layer:** The warm neutral surface (#F8FAF7).
2.  **Surface Layer:** High-polish cards use a pure white background to pop against the base layer.
3.  **Shadow Character:** Shadows are extremely diffused with a 10-15% opacity using a Forest Green tint rather than pure black. This prevents "dirty" shadows and reinforces the organic brand feel.
4.  **Interaction Depth:** Buttons utilize a slight inner-shadow when pressed to simulate a physical, tactile response, providing feedback to the user that an action has been registered.

## Shapes

The shape language is defined by **High-Polish Softness**. 

- **Primary Radius:** Large 24px (rounded-lg) corners are applied to all main content cards to create a friendly, modern container system.
- **Buttons & Inputs:** These utilize a 16px (base) or full pill-shape (rounded-xl) for buttons, signaling high touch-interactivity.
- **Icons & Badges:** Status badges use a 12px radius to maintain a distinct visual language from larger containers.

This high level of roundedness softens the industrial nature of logistics, making the platform feel like a sophisticated service rather than a rigid utility tool.

## Components

### Buttons
Primary buttons are solid Forest Green (#1B3A18) with white Manrope text. Secondary buttons use a Sage Green tint with Forest Green text. Buttons include a right-aligned arrow icon for "forward-moving" actions (e.g., "Accept Trip").

### Cards
Cards are the primary structural unit. They feature 24px rounded corners, a subtle 1px border in a pale sage tint, and a soft ambient shadow. Within cards, information is divided by thin horizontal rules (#E6EBE5).

### Inputs
Text fields use a 12px radius with a light gray border. When focused, the border transitions to Agricultural Green (#2D5A27) with a 1px weight. Labels are always positioned above the field in Be Vietnam Pro (Label-lg).

### Status Badges
Badges use high-contrast text on a low-opacity background of the status color (e.g., Success is Dark Green text on a light sage background). This ensures the status is readable without overwhelming the primary information.

### Progress Indicators
Steppers and progress bars use a 4px thickness with a rounded cap. Active states are Agricultural Green, while inactive states are a soft neutral gray.