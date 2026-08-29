## 2026-08-29 - Accessibility metadata for shared icon buttons
**Learning:** In React Native / Expo shared component sets, icon-only controls (like back arrows, notification bells, star ratings, and clear search buttons) lack accessible labels by default unless explicitly supplied via `accessibilityLabel`, `accessibilityRole`, and `accessibilityState`.
**Action:** Always supply `accessibilityRole="button"`, contextual `accessibilityLabel` strings, and appropriate `accessibilityState` on Pressable components that render icon-only children in `ui.tsx`.
