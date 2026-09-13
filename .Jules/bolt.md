## 2026-08-29 - [Avoid Redundant Engine Calculations in Pooling Loop]
**Learning:** In `poolForTransporter`, `quoteForJoining` already evaluates `priceTrip` / `priceTripById` to calculate candidate quotes. Recalling `priceTripById` in the same loop iteration to get `transporterEarning` duplicated MongoDB reads across `Trip`, `Vehicle`, and `TripShipment` collections.
**Action:** Always expose all needed pricing properties (such as `transporterEarning`) directly from `quoteForJoining` to eliminate redundant queries in hot loop iterations.

## 2026-08-30 - [Pre-fetch Trip Last Pickup to Avoid N+1 Queries in Request Prefiltering]
**Learning:** In `poolForTransporter`, `detourFor` executed `TripShipment.find` for every open request in the ranking loop (up to 60 queries). Since the active forming trip's shipments do not change during the request iteration, querying `TripShipment` inside `detourFor` was an N+1 query bottleneck.
**Action:** Pre-fetch the last pickup point once before looping over open requests and pass it directly to `detourFor` as a synchronous calculation.

## 2026-08-31 - [Batch Fetch Requesters in Backhaul Matching to Avoid N+1 Queries]
**Learning:** In `backhaulMatchesFor`, retrieving user profiles individually via `User.findById` inside the candidate matching loop resulted in up to 60 database roundtrips per request.
**Action:** Extract all `requesterId` values from `open` requests and pre-fetch matching `User` records in a single batch query (`User.find({ _id: { $in: requesterIds } })`) before starting candidate evaluation loops.
