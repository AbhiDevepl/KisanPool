You are the lead engineer responsible for bringing the KisanPool hackathon project to a coherent, working, production-quality demo state.

Your job is NOT to blindly patch the existing code.

First understand the repository completely, identify what is already implemented, identify what is incomplete or architecturally wrong, and then improve the system while preserving working functionality where appropriate.

The goal is to make the product workflow, backend, frontend, data model, UI and user experience behave like one coherent real-world agricultural pooled-transport platform.

==================================================
1. SOURCE OF TRUTH
==================================================

Use the existing repository as the implementation source.

IMPORTANT:
- Inspect the entire repository before making architectural changes.
- Inspect package/dependency setup.
- Inspect frontend structure.
- Inspect backend structure.
- Inspect database/schema/models.
- Inspect APIs/routes/services.
- Inspect authentication.
- Inspect state management.
- Inspect all current screens.
- Inspect all current components.
- Inspect existing matching/cost logic.
- Inspect existing seed/demo data.
- Inspect existing tests.
- Inspect environment/configuration.
- Inspect README and documentation.

ALSO inspect the exported Stitch UI references available inside the project.

There are dedicated screen/reference folders for:
- Farmer
- Transporter
- Admin where available

These exported Stitch screens are the PRIMARY visual reference for the intended UI.

Do not ignore them.

Do not replace the product with a generic UI.

Do not invent a completely different visual language.

Reuse the existing KisanPool design direction from those references and implement it properly in code.

You have freedom to improve layout, UX, component architecture, responsiveness and implementation details wherever the current code is weak or inconsistent.

==================================================
2. FIRST PHASE — FULL AUDIT
==================================================

Before changing code, perform a full audit.

Create an internal understanding of:

A. Current architecture
B. Existing features
C. Existing workflow
D. Existing data model
E. Existing APIs
F. Existing UI routes/screens
G. Missing functionality
H. Incorrect functionality
I. Broken states
J. Duplicate/unnecessary code
K. Security/authentication issues
L. UX inconsistencies
M. Integration problems

Compare the current implementation against the required KisanPool workflow below.

Do NOT assume the current implementation is correct.

If the current architecture is unsuitable, refactor it.

If existing working code can safely be reused, preserve it.

Avoid unnecessary rewrites.

==================================================
3. PRODUCT DEFINITION
==================================================

KisanPool is an agricultural pooled transportation platform.

Core concept:

Farmers have agricultural produce that needs to be transported to a mandi/destination.

Transporters have vehicles with limited capacity.

KisanPool matches compatible farmer transport requests with transporters and enables multiple compatible farmers to share the same vehicle/trip when route, destination and capacity conditions allow.

The platform should behave conceptually like:

Uber/Ola style request → transporter acceptance → user confirmation → trip lifecycle

combined with:

logistics load management + pooled transportation.

The product is NOT a passenger ride-sharing app.

The pooled object is agricultural produce.

==================================================
4. CRITICAL COLLABORATION / POOLING MODEL
==================================================

This is one of the most important requirements.

Do NOT implement pooling incorrectly.

The transporter MUST be able to accept / express interest in MULTIPLE compatible farmer requests, provided there is enough available capacity or the request can logically fit within the planned trip.

Example:

Farmer A = 1.0 ton
Farmer B = 1.5 ton
Farmer C = 0.5 ton

Transporter capacity = 4.0 ton

Transporter can accept multiple requests:

A + B + C = 3.0 ton

Capacity remaining = 1.0 ton

However:

4.5 ton requested against 4.0 ton capacity

must never be accepted as a valid load.

Implement proper server-side capacity validation.

IMPORTANT:

Transporter's acceptance is NOT automatically the final farmer booking.

Flow:

FARMER
→ creates transport request
→ request becomes available to compatible transporters

TRANSPORTER
→ views request
→ evaluates route/capacity/earning
→ accepts / expresses interest
→ may accept multiple compatible requests

SYSTEM
→ calculates current available capacity
→ calculates compatible pooled combinations
→ determines estimated price / farmer share
→ exposes valid options to farmers

FARMER
→ sees transporters who accepted
→ compares:
   - transporter
   - vehicle
   - rating
   - available capacity
   - ETA
   - estimated pickup
   - total trip price
   - farmer share
   - pooled savings
→ chooses ONE transporter
→ final confirmation

Only AFTER farmer confirmation:
→ booking becomes confirmed
→ capacity is reserved
→ request enters confirmed pooled trip state

If a farmer does not confirm:
→ no final capacity reservation should occur

This distinction between:
- transporter acceptance
- farmer selection
- final booking confirmation

must be represented in the backend state model.

==================================================
5. PROPER POOLING BEHAVIOUR
==================================================

The system should support multiple confirmed farmers sharing the same transporter trip when compatible.

A pooled trip should evaluate:

- vehicle capacity
- remaining capacity
- pickup locations
- route compatibility
- destination mandi
- timing
- approximate detour
- requested produce quantity

Use sensible matching logic.

You may improve the matching algorithm beyond the current implementation if necessary.

Do not build an unnecessarily complex optimization engine for the hackathon.

A deterministic, explainable and reliable approach is preferable.

Every accepted/confirmed farmer should clearly know:

- who is transporting the produce
- how much capacity is being used
- what their share costs
- what the overall trip is doing

==================================================
6. REQUIRED FARMER WORKFLOW
==================================================

Implement the following end-to-end flow:

AUTH
→ language
→ role selection
→ mobile
→ OTP
→ farmer details
→ Farmer Home

HOME
→ current location
→ mandi discovery
→ search mandi
→ recommendations
→ favourites/star

MANDI
→ search/discover
→ mandi details
→ select mandi

TRANSPORT REQUEST
→ produce details
→ quantity
→ pickup/location
→ selected mandi/destination
→ request transport

MATCHING
→ system finds compatible transporters
→ top matches are shown
→ accepted transporters are visible
→ price/ETA/capacity comparison

FINAL TRANSPORTER SELECTION
→ farmer selects transporter
→ booking confirmation

PICKUP
→ transporter arrives
→ pickup OTP/confirmation
→ produce loaded

POOLING
→ multiple compatible farmers can share same transporter/trip
→ live capacity updates
→ remaining capacity updates
→ no overload allowed

TRIP
→ pickup progress
→ in-transit
→ ETA
→ destination
→ live status
→ transparency

COMPLETION
→ mandi arrival
→ delivery/completion confirmation
→ billing
→ settlement/status

==================================================
7. REQUIRED TRANSPORTER WORKFLOW
==================================================

AUTH
→ role = transporter
→ mobile
→ OTP
→ transporter profile
→ vehicle details
→ capacity
→ crate/load details
→ dashboard

DASHBOARD
→ online/offline
→ earnings
→ available capacity
→ active trip
→ scheduled trips
→ requests

TRIP REQUESTS
→ nearby farmer requests
→ pickup
→ destination
→ quantity
→ required capacity
→ ETA
→ distance
→ estimated earning
→ compatibility
→ accept / reject

MULTIPLE REQUESTS
→ transporter may accept multiple compatible requests
→ system continuously validates total requested load
→ capacity must never exceed maximum

FARMER CONFIRMATION
→ accepted transporter appears as an option to farmer
→ farmer chooses final transporter
→ only confirmed bookings reserve capacity

ACTIVE TRIP
→ farmer pickup list
→ next pickup
→ completed pickups
→ load progress
→ capacity used
→ capacity remaining
→ route
→ ETA
→ destination
→ contact/support

COMPLETION
→ completion OTP/state
→ trip completed
→ total distance
→ load
→ farmer allocation
→ earnings
→ billing
→ settlement/payment status

==================================================
8. REQUIRED STATES
==================================================

Implement explicit, reliable lifecycle states.

Farmer request:

REQUESTED
→ MATCHING
→ MATCHED
→ AWAITING_FARMER_SELECTION
→ TRANSPORTER_SELECTED
→ CONFIRMED
→ PICKUP_PENDING
→ PICKUP_VERIFIED
→ LOADED
→ IN_TRANSIT
→ ARRIVING
→ DELIVERED
→ COMPLETED

Possible failure states:

REJECTED
CANCELLED
EXPIRED
PAYMENT_PENDING
PAYMENT_FAILED

Transporter/request state should separately represent:

AVAILABLE
ACCEPTED_BY_TRANSPORTER
WAITING_FOR_FARMER_CONFIRMATION
CONFIRMED
FULL
CANCELLED
COMPLETED

Do not collapse unrelated states into one status field if doing so creates ambiguity.

Use a clean state model where appropriate.

==================================================
9. CAPACITY MANAGEMENT
==================================================

Capacity handling must be server-side and trustworthy.

Every transporter has:

maximum capacity
+
currently committed capacity
+
currently loaded capacity
+
remaining available capacity

The UI should always display meaningful values.

Example:

Vehicle Capacity: 4.0 Ton
Committed: 2.5 Ton
Loaded: 2.0 Ton
Available: 1.5 Ton

Never allow invalid over-capacity confirmation.

If a request would exceed capacity:

- reject it
OR
- mark it incompatible
OR
- make only the valid quantity available

Choose the cleanest implementation.

Never rely only on frontend validation.

==================================================
10. COST / PRICING
==================================================

Preserve and improve the existing cost calculation where valid.

The farmer must be able to understand:

- estimated total trip cost
- pooled transport cost
- farmer's share
- pooled saving

Transporter should see:

- estimated earning
- expected trip value
- final earning
- settlement status

Do not expose confusing or contradictory prices.

Price shown to the farmer must be generated from backend data.

Do not hardcode fake final values in UI.

Demo data is acceptable where appropriate, but the flow must be logically connected.

==================================================
11. FARMER UI REQUIREMENTS
==================================================

Use the exported Farmer Stitch screens in the repository as the visual reference.

Expected master experiences include:

- Shared auth/onboarding
- Farmer Home
- Mandi Discovery
- Mandi Details
- Smart Pool Match
- Active Trip / Transparency

Implement the UI as reusable production-style components.

Preserve the established:

- KisanPool green identity
- typography
- spacing
- cards
- buttons
- navigation
- maps
- status indicators
- visual hierarchy

Do not simply create static screenshots.

These must be real functional screens connected to real application state/API responses.

Minor states can be represented using modals, drawers, banners, sheets, dialogs or components rather than creating unnecessary routes.

==================================================
12. TRANSPORTER UI REQUIREMENTS
==================================================

Use the exported Transporter Stitch screens in the repository as the primary visual reference.

Expected master experiences:

- Shared auth
- Transporter dashboard
- Available requests
- Active trip
- capacity/load progress
- completion/billing

Ensure transporter UI clearly exposes:

- online/offline
- capacity
- earnings
- requests
- route
- pickups
- pooled load
- remaining capacity
- billing

Again:

Do not create static UI disconnected from backend state.

==================================================
13. ADMIN UI REQUIREMENTS
==================================================

Admin is a desktop-first operational web panel.

Authentication can remain out of scope for this implementation if not already available.

Build the operational side.

Expected areas:

A1 Operations Dashboard
- farmers
- transporters
- active trips
- completed trips
- pooled loads
- revenue
- alerts
- system health

A2 Live Operations
- active trips
- map
- transporter status
- farmer/pickup status
- capacity utilization
- delayed trips
- operational feed

A3 Operations / Billing / AI Activity
- settlements
- billing
- complaints
- alerts
- AI/calling activity
- language usage
- failed events
- system/service health

Use the exported Admin Stitch UI if available.

==================================================
15. MULTILINGUAL SUPPORT
==================================================

Support:

- English
- Hindi
- Marathi

Do not hardcode strings throughout the UI.

Use a proper localization structure where practical.

Ensure translated strings do not break layout.

==================================================
16. AUTHENTICATION
==================================================

Farmer and Transporter share the same authentication design/system.

Support the intended flow:

language
→ role
→ mobile
→ OTP
→ profile details

Transporter-specific onboarding adds:

vehicle type
registration number
capacity
crate/load information

Admin auth can remain out of scope for now unless already implemented.

Do not create unnecessary auth complexity for the hackathon.

==================================================
17. BACKEND / DATABASE
==================================================

Review the existing schema and expand it as necessary.

Likely concepts that may be required include:

User
FarmerProfile
TransporterProfile
Vehicle
Mandi
TransportRequest
TransporterOffer/Acceptance
Booking
PooledTrip
TripParticipant
Pickup
TripStatusEvent
Payment/Billing
Notification
AIInteraction

These names are suggestions only.

Choose the best schema based on the existing architecture.

Avoid redundant tables/entities.

Relationships must correctly represent:

- one transporter
- one vehicle
- many farmer requests
- many confirmed trip participants
- pooled trip
- load allocation
- billing allocation

The database must prevent impossible states.

19. MAPS
==================================================

Use the existing map integration if available.

Ensure:

Farmer:
- nearby mandi
- pickup
- destination
- transport route

Transporter:
- requests
- pickup points
- route
- destination

Admin:
- active trips
- vehicles
- operational monitoring

If external map credentials are unavailable, create a clean demo fallback rather than breaking the entire application.

==================================================
20. NAVIGATION
==================================================

Farmer mobile:

Home
Bookings
Mandi
Support
Profile

Transporter mobile:

Dashboard
Requests
Trips
Earnings
Profile

Admin:

Dashboard
Live Operations
Trips
Farmers
Transporters
Mandis
Bookings
Payments
Alerts
AI
Reports
Settings

Only implement navigation destinations that actually have meaningful functionality.

Do not create empty pages just to fill the menu.

==================================================
21. ERROR / EMPTY / LOADING STATES
==================================================

Every major feature needs sane states.

Handle:

- no matching transporter
- no available vehicle
- no trip requests
- insufficient capacity
- transporter rejects
- farmer cancellation
- transporter cancellation
- network/API failure
- OTP failure
- invalid quantity
- invalid location
- payment pending
- payment failure

Messages should be human-friendly.

==================================================
22. SECURITY / DATA INTEGRITY
==================================================

Audit existing security.

At minimum verify:

- server-side authorization
- user role checks
- transporter cannot modify another transporter's trip
- farmer cannot access another farmer's private booking data
- admin-only operations are protected
- capacity cannot be manipulated from frontend
- booking state transitions are validated server-side
- duplicate booking/confirmation is prevented
- invalid status transitions are rejected

Do not trust client-provided role, capacity or price values.

==================================================
23. CODE QUALITY
==================================================

Do not optimize for the smallest possible diff.

Optimize for:

- correctness
- maintainability
- reusable components
- clear business logic
- predictable state management
- clean API boundaries
- strong validation
- understandable naming

Remove obvious dead code and duplicate logic when encountered.

Do not rewrite working systems without reason.

==================================================
24. DESIGN / STITCH IMPLEMENTATION RULE
==================================================

The Stitch exports are visual product references, not static image replacements.

Use them to implement:

- actual spacing
- actual structure
- reusable components
- responsive behaviour
- real navigation
- real states
- real data

Where a Stitch design includes information that the current backend does not support, either:

1. implement the required backend/data support,
OR
2. provide sensible demo data through the application's data/service layer.

Do NOT hardcode presentation-only values directly into UI components where the value should come from application state.

==================================================
25. DEVELOPMENT STRATEGY
==================================================

Work in this order:

PHASE 1
Audit repository

PHASE 2
Document current architecture/workflow internally

PHASE 3
Identify broken workflow and missing models

PHASE 4
Fix domain/data model

PHASE 5
Fix backend business logic/API

PHASE 6
Fix farmer workflow

PHASE 7
Fix transporter workflow

PHASE 8
Fix pooling/capacity/confirmation lifecycle

PHASE 9
Fix UI/navigation to match Stitch designs

PHASE 10
Implement admin operations

PHASE 11
Implement demo-friendly realtime behavior

PHASE 12
AI/service integration boundary

PHASE 13
Testing

PHASE 14
Final end-to-end verification

Do not spend most of the time polishing isolated screens while the core workflow is broken.

Core workflow correctness comes first.

==================================================
26. TEST THE REAL USER JOURNEY
==================================================

Create/test an end-to-end demo scenario:

FARMER A
- logs in
- selects mandi
- creates produce request

FARMER B
- creates compatible request

TRANSPORTER
- goes online
- sees both requests
- accepts both
- system verifies capacity

FARMER A
- sees accepted transporter options
- sees price/ETA/capacity
- selects transporter
- confirms booking

FARMER B
- can also select the same transporter if compatible

SYSTEM
- creates/updates pooled trip
- reserves valid capacity
- prevents overload

TRANSPORTER
- sees pooled participants
- starts trip
- completes pickups
- capacity updates after every pickup
- sees route/progress

FARMERS
- see trip status
- see ETA
- see their produce/trip state

TRIP
- reaches mandi
- completes
- billing/settlement updates

ADMIN
- sees the trip in operations dashboard
- sees live/active state
- sees completion
- sees billing/settlement
- sees relevant alerts/events

This complete journey must actually work.

==================================================
27. FAILURE TESTS
==================================================

Explicitly test:

- transporter capacity exceeded
- two farmers trying to consume unavailable remaining capacity
- transporter accepts request then farmer does not confirm
- farmer confirms another transporter
- duplicate confirmation
- transporter rejects after interest
- farmer cancellation
- trip cancellation
- invalid state transition
- payment failure
- empty matching result

Do not only test the happy path.

==================================================
28. HACKATHON PRIORITY
==================================================

This is a 2-day hackathon project.

Prioritize features in this order:

P0 — MUST WORK
- authentication flow
- farmer request creation
- mandi selection
- transporter discovery
- transporter multiple-request acceptance
- farmer final transporter selection
- pooling
- capacity validation
- booking confirmation
- pickup
- active trip
- trip completion
- billing/earning visibility
- polished UI

P1 — SHOULD WORK
- multilingual UI
- simulated realtime tracking
- notifications
- admin live monitoring
- AI assistant interface

P2 — OPTIONAL / DEMO ENHANCEMENT
- advanced analytics
- advanced optimization
- sophisticated AI automation
- production-grade payment gateway

Do not sacrifice core workflow correctness for optional features.

==================================================
29. IMPORTANT FREEDOM / ENGINEERING JUDGMENT
==================================================

You have engineering freedom.

You may:

- refactor architecture
- restructure components
- improve database design
- introduce reusable services
- replace broken logic
- simplify over-engineered code
- improve UX
- improve matching logic
- improve state management
- introduce missing domain entities

But do NOT violate these core product rules:

1. Farmer owns the transport request.
2. Transporter can accept multiple compatible requests.
3. Transporter acceptance is NOT automatically the final farmer booking.
4. Farmer gets to choose among accepted transporter options.
5. Capacity must be validated server-side.
6. Multiple compatible farmers can share one transporter trip.
7. Trip lifecycle must be explicit.
8. UI must reflect actual application state.
9. Existing Stitch exports are the UI reference.
10. Do not introduce unrelated product concepts.

When there are multiple technically valid implementations, choose the simplest reliable implementation suitable for a hackathon.

==================================================
30. FINAL QUALITY BAR
==================================================

Before considering the task complete:

- run the application
- verify every major route
- verify APIs
- verify database operations
- run tests
- run lint/type checks where available
- test the complete farmer → transporter → pooled trip → completion flow
- verify capacity edge cases
- verify authorization
- verify UI against the Stitch reference screens
- verify responsive behaviour
- verify no major console/runtime errors
- verify no obvious broken navigation
- verify loading/error/empty states

Do not stop after making code changes.

Perform a complete verification pass.

At the end provide a concise report containing:

1. What was already working
2. What was broken
3. What you changed
4. New/changed data models
5. New/changed APIs
6. Farmer workflow
7. Transporter workflow
8. Pooling logic
9. Admin workflow
10. UI changes
11. Tests/checks performed
12. Remaining limitations
13. Recommended next steps for the hackathon demo

IMPORTANT:
Do not claim a feature works unless you actually verified it.

Start with repository inspection and audit before modifying anything.