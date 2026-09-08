## 2026-08-29 - [Avoid Redundant Engine Calculations in Pooling Loop]
**Learning:** In `poolForTransporter`, `quoteForJoining` already evaluates `priceTrip` / `priceTripById` to calculate candidate quotes. Recalling `priceTripById` in the same loop iteration to get `transporterEarning` duplicated MongoDB reads across `Trip`, `Vehicle`, and `TripShipment` collections.
**Action:** Always expose all needed pricing properties (such as `transporterEarning`) directly from `quoteForJoining` to eliminate redundant queries in hot loop iterations.

## 2026-08-30 - [Pre-fetch Trip Last Pickup to Avoid N+1 Queries in Request Prefiltering]
**Learning:** In `poolForTransporter`, `detourFor` executed `TripShipment.find` for every open request in the ranking loop (up to 60 queries). Since the active forming trip's shipments do not change during the request iteration, querying `TripShipment` inside `detourFor` was an N+1 query bottleneck.
**Action:** Pre-fetch the last pickup point once before looping over open requests and pass it directly to `detourFor` as a synchronous calculation.

## 2026-08-31 - [Pre-fetch Requesters to Eliminate N+1 Queries in Backhaul Matching]
**Learning:** In `backhaulMatchesFor`, `User.findById(request.requesterId)` was executed inside the request iteration loop for every candidate match (up to 60 queries). Since open request requester IDs are known upfront from the database result, querying `User` inside the loop created an N+1 query bottleneck.
**Action:** Pre-fetch all open request requesters in a single `User.find({ _id: { $in: requesterIds } })` batch query prior to the loop and map them for O(1) synchronous lookups.
