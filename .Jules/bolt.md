## 2026-08-29 - [Avoid Redundant Engine Calculations in Pooling Loop]
**Learning:** In `poolForTransporter`, `quoteForJoining` already evaluates `priceTrip` / `priceTripById` to calculate candidate quotes. Recalling `priceTripById` in the same loop iteration to get `transporterEarning` duplicated MongoDB reads across `Trip`, `Vehicle`, and `TripShipment` collections.
**Action:** Always expose all needed pricing properties (such as `transporterEarning`) directly from `quoteForJoining` to eliminate redundant queries in hot loop iterations.

## 2026-08-30 - [Pre-fetch Trip Last Pickup to Avoid N+1 Queries in Request Prefiltering]
**Learning:** In `poolForTransporter`, `detourFor` executed `TripShipment.find` for every open request in the ranking loop (up to 60 queries). Since the active forming trip's shipments do not change during the request iteration, querying `TripShipment` inside `detourFor` was an N+1 query bottleneck.
**Action:** Pre-fetch the last pickup point once before looping over open requests and pass it directly to `detourFor` as a synchronous calculation.

## 2026-09-02 - [Pre-fetch Transporters and Vehicles to Avoid N+1 Queries in Request Offers]
**Learning:** In `offersForRequest`, mapping over transporter offers previously performed individual `User.findById` and `Vehicle.findById` calls per offer, creating an N+1 database query bottleneck (2N queries for N offers).
**Action:** Pre-fetch distinct `User` and `Vehicle` records in bulk using `$in` queries before mapping and index them into `Map`s for O(1) lookups.
