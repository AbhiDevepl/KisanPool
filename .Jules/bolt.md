## 2026-08-29 - [Avoid Redundant Engine Calculations in Pooling Loop]
**Learning:** In `poolForTransporter`, `quoteForJoining` already evaluates `priceTrip` / `priceTripById` to calculate candidate quotes. Recalling `priceTripById` in the same loop iteration to get `transporterEarning` duplicated MongoDB reads across `Trip`, `Vehicle`, and `TripShipment` collections.
**Action:** Always expose all needed pricing properties (such as `transporterEarning`) directly from `quoteForJoining` to eliminate redundant queries in hot loop iterations.

## 2026-08-30 - [Pre-fetch Trip Last Pickup to Avoid N+1 Queries in Request Prefiltering]
**Learning:** In `poolForTransporter`, `detourFor` executed `TripShipment.find` for every open request in the ranking loop (up to 60 queries). Since the active forming trip's shipments do not change during the request iteration, querying `TripShipment` inside `detourFor` was an N+1 query bottleneck.
**Action:** Pre-fetch the last pickup point once before looping over open requests and pass it directly to `detourFor` as a synchronous calculation.

## 2026-08-31 - [Batch Transporter Stats and Share Documents in Prediction Signal Gathering]
**Learning:** In `assessOps` and `assessTrip`, evaluating prediction signals performed up to 10 MongoDB calls per trip, repeatedly fetching `Vehicle`, `TripShipment`, `User`, and calculating identical transporter stats across multiple active trips of the same transporter (up to 400 queries per roll-up).
**Action:** Batch-fetch transporter users, pre-calculate transporter stats per unique transporter ID, and pass prefetched `Vehicle` and `TripShipment` documents down to `delaySignalsFor` and `cancellationSignalsFor` to eliminate duplicate round-trips.
