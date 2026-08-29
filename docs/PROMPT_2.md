# kisanpool — Major Flow Redesign & System Architecture Update

## Role

You are a senior software architect and backend engineer responsible for redesigning the existing kisanpool application around the corrected business flow described below.

The current application flow is incorrect and must be **restructured**, not merely patched.

# 1. Correct Product Flow

The fundamental kisanpool flow must be redesigned around a **request pool + transporter claiming + farmer selection + dynamic shared transportation** model.

The system has two primary actors:

* Farmer
* Transporter

The system acts as the coordination and real-time pricing/matching layer.

---

# 2. Farmer Creates a Transportation Request

Multiple farmers can independently create requests:

```text
farmer_1
farmer_2
farmer_3
...
farmer_N
```

Each farmer creates a transportation request containing at minimum:

```text
produce/material name
quantity
pickup location
pickup coordinates
destination mandi
destination coordinates
required pickup time / preferred time
additional requirements
```

## Pickup Location

The farmer should be able to select the pickup location using a map.

The application should obtain:

```text
latitude
longitude
address
```

Prefer the farmer's current GPS location when available, but allow manual map selection.

---

# 3. Destination Selection

The farmer should select the destination from nearby/available mandis.

The destination must be map-based.

The system should support:

```text
nearby mandis
mandi search
map selection
coordinates
distance calculation
```

Store both:

```text
destination_name
destination_latitude
destination_longitude
```

Do not store only a textual address.

Coordinates are required for route calculation, proximity search, and transporter matching.

---

# 4. Request Pool

After the farmer submits the request, it enters a centralized transportation request pool.

Example:

```text
REQUEST POOL

Farmer 1 → 100 kg → Location A → Mandi X
Farmer 2 → 200 kg → Location B → Mandi X
Farmer 3 → 150 kg → Location C → Mandi X
Farmer 4 → 350 kg → Location D → Mandi X
...
```

The request is **not immediately permanently assigned to a transporter**.

Instead, it becomes available to eligible nearby active transporters.

---

# 5. Nearby Active Transporter Visibility

Only eligible nearby active transporters should be able to see relevant requests.

A transporter should receive requests based on factors such as:

```text
transporter active status
current GPS location
pickup proximity
vehicle capacity
vehicle type
route compatibility
destination compatibility
availability
```

The backend should perform geographic filtering rather than sending every request to every transporter.

Example:

```text
Farmer Request
      ↓
Geo Matching
      ↓
Nearby Active Transporters
      ↓
Transporter Request Pool
```

The system should support geospatial queries efficiently.

---

# 6. Transporter Claims / Shows Interest in a Request

Suppose:

```text
Transporter_1
```

sees:

```text
Farmer_2 request
```

and accepts/claims/shows interest in that request.

This does **not** immediately mean that Transporter_1 has been finally selected by the farmer.

Instead:

```text
Transporter_1
      ↓
claims Farmer_2 request
      ↓
Farmer_2 receives real-time notification
```

The farmer is informed that one or more transporters are interested in fulfilling the request.

---

# 7. Farmer Receives Multiple Transporter Options

A farmer may receive multiple transporter candidates.

Example:

```text
Farmer_2 Request

Available Transporters

Transporter A
Rating: 4.8
Estimated Charge: ₹X
Distance: X km
Vehicle: 1000 kg
Current Location: ...
Route: ...

Transporter B
Rating: 4.6
Estimated Charge: ₹Y
Distance: X km
Vehicle: 1200 kg
Current Location: ...
Route: ...

Transporter C
Rating: 4.9
Estimated Charge: ₹Z
Distance: X km
Vehicle: 1000 kg
Current Location: ...
Route: ...
```

The farmer must be able to compare transporters.

Filtering/ranking should support:

```text
price
rating
distance
ETA
vehicle capacity
route compatibility
transporter reliability
```

The ranking system should be configurable and should not be hardcoded into the UI.

---

# 8. Farmer Selects the Transporter

The farmer makes the final transporter selection.

The UI should provide an explicit confirmation interaction.

For example:

```text
Swipe to Confirm Transporter
```

After confirmation:

```text
Farmer
   ↓
confirms Transporter
   ↓
Transporter assignment created
   ↓
Trip/route becomes active
```

The transporter should receive a real-time confirmation notification.

The request state should change accordingly.

Example:

```text
OPEN
   ↓
TRANSPORTER_INTERESTED
   ↓
FARMER_SELECTING
   ↓
TRANSPORTER_CONFIRMED
```

The exact state machine should be formally documented and implemented consistently across backend and frontend.

---

# 9. Shared Transportation Begins

Now the important part of kisanpool begins.

A transporter does not necessarily transport only one farmer's material.

Suppose:

```text
Transporter_1 truck capacity = 1000 kg
```

Farmer 1:

```text
100 kg
```

The transporter can continue accepting compatible farmers along the route.

Example:

```text
Transporter_1
Truck Capacity: 1000 kg

Farmer_1 → 100 kg
Farmer_2 → 200 kg
Farmer_3 → 150 kg
Farmer_4 → 350 kg

Total = 800 kg
Remaining = 200 kg
```

This is the core shared-load functionality.

---

# 10. Route-Based Farmer Selection

The transporter should be able to see additional farmer requests that are compatible with the current trip.

Potential next farmers should be evaluated using:

```text
pickup location
current transporter location
existing route
destination
route deviation
pickup sequence
remaining capacity
requested pickup time
delivery constraints
```

The system should not simply show all nearby farmers.

It should prioritize requests that make logistical sense for the current route.

Example:

```text
Current Route:

Transporter
    ↓
Farmer_1
    ↓
Farmer_2
    ↓
Farmer_3
    ↓
Farmer_4
    ↓
Mandi
```

The backend should calculate whether adding another farmer is beneficial and feasible.

---

# 11. Dynamic Capacity

Vehicle capacity must be tracked in real time.

Example:

```text
Truck Capacity = 1000 kg

Farmer_1 = 100 kg

Used Capacity = 100 kg
Remaining Capacity = 900 kg
```

After Farmer_2:

```text
Farmer_1 = 100 kg
Farmer_2 = 200 kg

Used Capacity = 300 kg
Remaining Capacity = 700 kg
```

Continue until:

```text
Used Capacity <= Vehicle Capacity
```

The system must never allow:

```text
Used Capacity > Vehicle Capacity
```

Capacity reservation must be concurrency-safe.

If two farmers are being accepted simultaneously, the backend must prevent both from consuming the same remaining capacity.

Use database transactions / row locking / atomic reservation logic where appropriate.

---

# 12. Dynamic Shared Pricing

Pricing is one of the most important parts of the new architecture.

The transport price should be recalculated dynamically as additional farmers join the same route.

Example:

```text
Truck Capacity = 1000 kg

Farmer_1
Quantity = 100 kg

Initial calculated price:
₹P
```

Then:

```text
Farmer_2
Quantity = 200 kg
```

joins the same route.

The route cost can now be distributed across:

```text
Farmer_1
Farmer_2
```

The individual farmer prices may decrease because the transportation cost is shared.

The system must calculate the updated price according to the defined pricing algorithm.

Example conceptual model:

```text
Total Route Cost
        ↓
Shared among compatible loads
        ↓
Farmer-specific allocation
```

Do not implement arbitrary price reduction directly in frontend code.

Pricing must be calculated by the backend.

---

# 13. Real-Time Price Updates

Whenever the shared route changes, affected farmers must receive real-time updates.

Example:

```text
Farmer_1 price
₹500
```

Farmer_2 joins.

Backend recalculates:

```text
Farmer_1 → ₹350
Farmer_2 → ₹650
```

The backend sends Socket.IO events.

Example conceptual event:

```text
trip:pricing_updated
```

Payload:

```json
{
  "tripId": "...",
  "pricingVersion": 3,
  "updates": [
    {
      "farmerId": "...",
      "amount": 350
    },
    {
      "farmerId": "...",
      "amount": 650
    }
  ]
}
```

The frontend must update the displayed price without requiring a page refresh.

---

# 14. Real-Time Trip State

Socket.IO should be used for real-time operational events such as:

```text
transporter interested
transporter selected
transporter location updated
farmer added to shared trip
farmer removed from trip
capacity changed
price recalculated
pickup approaching
pickup completed
route updated
trip status changed
payment requested
payment completed
```

However:

**Socket.IO is not the source of truth.**

The database remains the authoritative state.

Socket.IO is the real-time delivery mechanism.

If a client disconnects, it must be able to reconnect and retrieve the current state from the API.

---

# 15. Transporter Route

The transporter can progressively build a shared trip.

Example:

```text
Truck: 1000 kg

1. Farmer_1 → 100 kg
2. Farmer_2 → 200 kg
3. Farmer_3 → 150 kg
4. Farmer_4 → 350 kg

Total = 800 kg
Remaining = 200 kg
```

The transporter can continue seeing eligible requests until:

```text
capacity is full
OR
route constraints prevent additional pickups
OR
pickup deadline is reached
OR
transporter chooses to stop accepting requests
OR
destination is reached
```

---

# 16. Pickup Lifecycle

Each farmer's shipment should have an independent shipment/pickup lifecycle within the shared trip.

Example:

```text
REQUEST_CREATED
      ↓
VISIBLE_TO_TRANSPORTERS
      ↓
TRANSPORTER_INTERESTED
      ↓
FARMER_SELECTED_TRANSPORTER
      ↓
ASSIGNED_TO_TRIP
      ↓
TRANSPORTER_EN_ROUTE
      ↓
PICKUP_ARRIVED
      ↓
MATERIAL_PICKED_UP
      ↓
IN_TRANSIT
      ↓
DELIVERED
      ↓
PAYMENT_PENDING
      ↓
PAID
      ↓
COMPLETED
```

Do not use one generic status for the entire system.

Trip status and shipment status must be separate.

---

# 17. Delivery

When the transporter reaches the destination mandi:

```text
Trip
   ↓
Destination Reached
   ↓
Farmer shipments delivered
```

Each farmer's shipment should be marked delivered independently.

Example:

```text
Farmer_1 → Delivered
Farmer_2 → Delivered
Farmer_3 → Delivered
Farmer_4 → Delivered
```

The transporter should have the ability to confirm delivery/pickup milestones.

---

# 18. Payment Flow

After delivery:

```text
Shipment Delivered
      ↓
Final Price Calculated
      ↓
Farmer Receives Payment Notification
      ↓
Farmer Pays Bill
      ↓
Payment Confirmed
      ↓
Shipment Completed
```

The final amount should be calculated from the authoritative backend pricing state.

The system should maintain:

```text
estimated_price
current_price
final_price
payment_status
payment_transaction_id
payment_timestamp
```

Do not overwrite historical prices without maintaining an audit trail.

Possible states:

```text
INTERESTED
WITHDRAWN
SELECTED
REJECTED
EXPIRED
```

This allows one farmer request to have multiple transporter candidates.

---

# 20. Trips

Create a shared transportation trip entity:

```text
trips
```

Example:

```text
id
transporter_id
vehicle_id
destination_id
status
total_capacity_kg
used_capacity_kg
remaining_capacity_kg
route_distance
estimated_route_cost
pricing_version
started_at
completed_at
```

---

# 21. Trip Shipments

A trip can contain multiple farmers.

Therefore create:

```text
trip_shipments
```

Example:

```text
id
trip_id
transport_request_id
farmer_id
quantity_kg
pickup_sequence
pickup_status
delivery_status
allocated_price
final_price
created_at
updated_at
```

This becomes the core relationship:

```text
Trip
 ├── Shipment → Farmer_1
 ├── Shipment → Farmer_2
 ├── Shipment → Farmer_3
 └── Shipment → Farmer_4
```

---

# 22. Pricing

Pricing should be its own domain rather than being embedded entirely inside trip/shipment records.

Consider:

```text
trip_pricing
shipment_pricing
pricing_events
```

Maintain pricing history.

Example:

```text
Pricing Version 1
Farmer_1 → ₹500

Pricing Version 2
Farmer_1 → ₹350
Farmer_2 → ₹650

Pricing Version 3
Farmer_1 → ₹300
Farmer_2 → ₹500
Farmer_3 → ₹400
```

This creates an auditable pricing history.
