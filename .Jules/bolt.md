## 2026-08-29 - [Avoid Redundant Engine Calculations in Pooling Loop]
**Learning:** In `poolForTransporter`, `quoteForJoining` already evaluates `priceTrip` / `priceTripById` to calculate candidate quotes. Recalling `priceTripById` in the same loop iteration to get `transporterEarning` duplicated MongoDB reads across `Trip`, `Vehicle`, and `TripShipment` collections.
**Action:** Always expose all needed pricing properties (such as `transporterEarning`) directly from `quoteForJoining` to eliminate redundant queries in hot loop iterations.
