import { Router } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAdmin } from '../../middleware/auth';
import { signAdminToken } from '../../lib/jwt';
import {
  LOADED_STATES,
  OCCUPIES_CAPACITY,
  PAYMENT_STATUSES,
  VEHICLE_STATUSES,
  VERIFICATION_STATUSES,
  type TripCapacity,
  type TripState,
} from '@kisanpool/shared';
import {
  KycDocument,
  Payment,
  PricingEvent,
  Rating,
  TransportRequest,
  TransporterOffer,
  TransporterPayoutAccount,
  AiSession,
  Trip,
  TripShipment,
  User,
  Vehicle,
} from '../../models';
import { reconcileVehicleVerification } from '../documents/service';

export const adminRouter = Router();

/** The states an operator can still act on. Anything else is history, not operations. */
const ACTIVE_TRIP_STATES: TripState[] = ['FORMING', 'EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'];

/**
 * Capacity for many trips in one query.
 *
 * `capacityOf()` is the single-trip form and reads that trip's shipments; the live
 * board renders every active trip at once and refreshes on a timer, so using it
 * per row would be one round trip per row, several times a minute. Same derivation
 * (shipments, never a stored counter) — just batched.
 */
async function capacitiesFor(
  trips: Array<{ _id: unknown; totalCapacityKg: number }>,
): Promise<Map<string, TripCapacity>> {
  const shipments = await TripShipment.find(
    { tripId: { $in: trips.map((t) => t._id) } },
    'tripId state quantityKg',
  );

  return new Map(
    trips.map((trip) => {
      const mine = shipments.filter((s) => String(s.tripId) === String(trip._id));
      const committedKg = mine
        .filter((s) => OCCUPIES_CAPACITY.includes(s.state))
        .reduce((sum, s) => sum + s.quantityKg, 0);
      return [
        String(trip._id),
        {
          totalKg: trip.totalCapacityKg,
          committedKg,
          loadedKg: mine
            .filter((s) => LOADED_STATES.includes(s.state))
            .reduce((sum, s) => sum + s.quantityKg, 0),
          availableKg: Math.max(0, trip.totalCapacityKg - committedKg),
        },
      ];
    }),
  );
}

const minutesSince = (at: Date | null | undefined): number =>
  at ? Math.round((Date.now() - new Date(at).getTime()) / 60000) : 0;


/** Constant-time compare so the login does not leak the password by timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

adminRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);

    const okUser = safeEqual(username, config.admin.username);
    const okPass = safeEqual(password, config.admin.password);
    // both are evaluated regardless, so a wrong username is not faster than a wrong password
    if (!okUser || !okPass) {
      throw new ApiError('AUTH_UNAUTHENTICATED', 'Wrong username or password.');
    }

    ok(res, { token: signAdminToken(), usingDefaultCredentials: config.admin.usingDefaults });
  }),
);

// ---------- 1. overall stats ----------

adminRouter.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [users, vehicles, requests, payments, ratings, docs, trips, shipments, offers] =
      await Promise.all([
      User.find({}, 'role ratingAvg createdAt'),
      Vehicle.find({}, 'status verificationStatus capacityKg availableCapacityKg'),
      TransportRequest.find({}, 'state quantityKg createdAt'),
      Payment.find({}, 'status amount transporterPayoutAmount transferId'),
      Rating.find({}, 'stars'),
      KycDocument.find({}, 'status'),
      Trip.find({}, 'state'),
      TripShipment.find({}, 'state quantityKg soloPrice finalPrice'),
      TransporterOffer.find({}, 'state'),
    ]);

    const countBy = <T>(items: T[], pick: (item: T) => string): Record<string, number> =>
      items.reduce<Record<string, number>>((acc, item) => {
        const value = pick(item);
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
      }, {});

    const paid = payments.filter((p) => p.status === 'PAID');
    const capacityTotal = vehicles.reduce((sum, v) => sum + v.capacityKg, 0);
    const capacityFree = vehicles.reduce((sum, v) => sum + v.availableCapacityKg, 0);

    ok(res, {
      users: {
        total: users.length,
        byRole: countBy(users, (u) => u.role),
        newThisWeek: users.filter(
          (u) => Date.now() - new Date(u.get('createdAt') as Date).getTime() < 7 * 86400000,
        ).length,
      },
      vehicles: {
        total: vehicles.length,
        byStatus: countBy(vehicles, (v) => v.status),
        byVerification: countBy(vehicles, (v) => v.verificationStatus),
        capacityTotalKg: capacityTotal,
        capacityInUseKg: capacityTotal - capacityFree,
        utilisationPct: capacityTotal
          ? Math.round(((capacityTotal - capacityFree) / capacityTotal) * 100)
          : 0,
      },
      requests: {
        total: requests.length,
        byState: countBy(requests, (r) => r.state),
        open: requests.filter((r) => ['OPEN', 'TRANSPORTER_INTERESTED'].includes(r.state)).length,
        cancelled: requests.filter((r) => r.state === 'CANCELLED').length,
      },
      trips: {
        total: trips.length,
        byState: countBy(trips, (t) => t.state),
        active: trips.filter((t) => ['FORMING', 'EN_ROUTE', 'IN_TRANSIT'].includes(t.state)).length,
        completed: trips.filter((t) => t.state === 'COMPLETED').length,
        // the number that says whether pooling is actually happening
        avgPoolSize: trips.length
          ? Math.round(
              (shipments.filter((s) => s.state !== 'CANCELLED').length / trips.length) * 10,
            ) / 10
          : 0,
        tonnesMoved:
          Math.round(
            (shipments
              .filter((s) => ['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'].includes(s.state))
              .reduce((sum, s) => sum + s.quantityKg, 0) /
              1000) *
              10,
          ) / 10,
      },
      pooling: {
        shipments: shipments.length,
        // what pooling saved farmers in total, in rupees
        totalSaved: Math.round(
          shipments
            .filter((s) => s.finalPrice != null)
            .reduce((sum, s) => sum + Math.max(0, s.soloPrice - (s.finalPrice ?? 0)), 0),
        ),
        offersOpen: offers.filter((o) => o.state === 'INTERESTED').length,
      },
      money: {
        collected: Math.round(paid.reduce((sum, p) => sum + p.amount, 0)),
        paidOut: Math.round(
          payments
            .filter((p) => p.transferId)
            .reduce((sum, p) => sum + p.transporterPayoutAmount, 0),
        ),
        refunded: payments.filter((p) =>
          ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(p.status),
        ).length,
        byStatus: countBy(payments, (p) => p.status),
      },
      trust: {
        ratings: ratings.length,
        avgStars: ratings.length
          ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / ratings.length) * 10) / 10
          : 0,
        documentsPending: docs.filter((d) => d.status === 'PENDING').length,
      },
    });
  }),
);

// ---------- 2. user data ----------

adminRouter.get(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { q, role } = z
      .object({ q: z.string().optional(), role: z.enum(['FARMER', 'TRANSPORTER']).optional() })
      .parse(req.query);

    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }];

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);

    // one round trip each, then joined in memory — the operator list is small
    const [vehicles, requests] = await Promise.all([
      Vehicle.find({ ownerId: { $in: users.map((u) => u._id) } }),
      TransportRequest.find({ farmerId: { $in: users.map((u) => u._id) } }, 'farmerId state'),
    ]);

    ok(
      res,
      users.map((user) => {
        const vehicle = vehicles.find((v) => String(v.ownerId) === String(user._id));
        const trips = requests.filter((r) => String(r.farmerId) === String(user._id));
        return {
          _id: String(user._id),
          name: user.name,
          phone: user.phone,
          role: user.role,
          language: user.language,
          location: user.defaultLocation?.name ?? null,
          ratingAvg: user.ratingAvg,
          ratingCount: user.ratingCount,
          phoneVerifiedAt: user.phoneVerifiedAt ?? null,
          createdAt: user.get('createdAt'),
          hasPushToken: Boolean(user.pushToken),
          vehicle: vehicle
            ? {
                _id: String(vehicle._id),
                registrationNumber: vehicle.registrationNumber,
                verificationStatus: vehicle.verificationStatus,
                status: vehicle.status,
              }
            : null,
          requestCount: trips.length,
          confirmedCount: trips.filter((t) => t.state === 'CONFIRMED').length,
        };
      }),
    );
  }),
);

// ---------- 3. driver document verification ----------

adminRouter.get(
  '/documents',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(VERIFICATION_STATUSES).optional() })
      .parse(req.query);

    const docs = await KycDocument.find(status ? { status } : {}).sort({ createdAt: -1 });
    const [owners, vehicles] = await Promise.all([
      User.find({ _id: { $in: docs.map((d) => d.userId) } }, 'name phone role'),
      Vehicle.find({ ownerId: { $in: docs.map((d) => d.userId) } }),
    ]);

    // grouped by transporter — RC and DL are approved together, so reviewing
    // them one row at a time is the wrong unit of work
    const byUser = new Map<string, { user: unknown; vehicle: unknown; documents: unknown[] }>();
    for (const doc of docs) {
      const key = String(doc.userId);
      if (!byUser.has(key)) {
        const owner = owners.find((o) => String(o._id) === key);
        const vehicle = vehicles.find((v) => String(v.ownerId) === key);
        byUser.set(key, {
          user: owner
            ? { _id: key, name: owner.name, phone: owner.phone, role: owner.role }
            : { _id: key, name: 'Unknown', phone: '', role: 'TRANSPORTER' },
          vehicle: vehicle
            ? {
                _id: String(vehicle._id),
                registrationNumber: vehicle.registrationNumber,
                vehicleType: vehicle.vehicleType,
                capacityKg: vehicle.capacityKg,
                verificationStatus: vehicle.verificationStatus,
              }
            : null,
          documents: [],
        });
      }
      byUser.get(key)?.documents.push({
        _id: String(doc._id),
        type: doc.type,
        fileUrl: doc.fileUrl,
        status: doc.status,
        reviewedAt: doc.reviewedAt ?? null,
        rejectionReason: doc.rejectionReason ?? null,
        createdAt: doc.get('createdAt'),
      });
    }

    ok(res, [...byUser.values()]);
  }),
);

adminRouter.patch(
  '/documents/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, reason } = z
      .object({ status: z.enum(VERIFICATION_STATUSES), reason: z.string().optional() })
      .parse(req.body);

    const doc = await KycDocument.findById(req.params.id);
    if (!doc) throw new ApiError('RESOURCE_NOT_FOUND', 'Document not found.');

    doc.status = status;
    doc.reviewedAt = new Date();
    doc.rejectionReason = status === 'REJECTED' ? reason : undefined;
    await doc.save();

    // RC + DL approved is what actually flips the vehicle into matching
    await reconcileVehicleVerification(String(doc.userId));
    const vehicle = await Vehicle.findOne({ ownerId: doc.userId });

    ok(res, { document: doc, vehicleVerification: vehicle?.verificationStatus ?? null });
  }),
);

// ---------- 4. on-road vehicles ----------

adminRouter.get(
  '/vehicles',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const vehicles = await Vehicle.find().sort({ status: 1, updatedAt: -1 });
    const [owners, activeTrips] = await Promise.all([
      User.find({ _id: { $in: vehicles.map((v) => v.ownerId) } }, 'name phone ratingAvg'),
      Trip.find(
        {
          vehicleId: { $in: vehicles.map((v) => v._id) },
          state: { $in: ACTIVE_TRIP_STATES },
        },
        'vehicleId state destination startedAt totalCapacityKg',
      ),
    ]);

    // a trip is a shared pool now, so "on road" is not a yes/no — the useful
    // number is how much of the truck is already sold and who is aboard
    const [capacities, poolSizes] = await Promise.all([
      capacitiesFor(activeTrips),
      TripShipment.find(
        { tripId: { $in: activeTrips.map((t) => t._id) }, state: { $ne: 'CANCELLED' } },
        'tripId',
      ),
    ]);

    ok(
      res,
      vehicles.map((vehicle) => {
        const owner = owners.find((o) => String(o._id) === String(vehicle.ownerId));
        const trip = activeTrips.find((t) => String(t.vehicleId) === String(vehicle._id));
        return {
          _id: String(vehicle._id),
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          status: vehicle.status,
          verificationStatus: vehicle.verificationStatus,
          capacityKg: vehicle.capacityKg,
          availableCapacityKg: vehicle.availableCapacityKg,
          ratePerKm: vehicle.ratePerKm,
          currentLocation: vehicle.currentLocation ?? null,
          updatedAt: vehicle.get('updatedAt'),
          owner: owner
            ? { name: owner.name, phone: owner.phone, ratingAvg: owner.ratingAvg }
            : null,
          activeTrip: trip
            ? {
                _id: String(trip._id),
                state: trip.state,
                to: trip.destination.name,
                startedAt: trip.startedAt ?? null,
                capacity: capacities.get(String(trip._id)) ?? null,
                poolSize: poolSizes.filter((s) => String(s.tripId) === String(trip._id)).length,
              }
            : null,
        };
      }),
    );
  }),
);

adminRouter.patch(
  '/vehicles/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        status: z.enum(VEHICLE_STATUSES).optional(),
        verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
        currentLocation: z.object({ lat: z.number(), lng: z.number() }).optional(),
      })
      .parse(req.body);

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'Vehicle not found.');

    // an operator may not put an unverified vehicle on the road — that is the
    // one rule the console must not be able to bypass (ADR-010)
    if (body.status === 'AVAILABLE') {
      const willBeVerified = body.verificationStatus ?? vehicle.verificationStatus;
      if (willBeVerified !== 'VERIFIED') {
        throw new ApiError(
          'KYC_PENDING_REVIEW',
          'Verify this vehicle before putting it on the road.',
        );
      }
    }

    vehicle.set(body);
    await vehicle.save();
    ok(res, vehicle);
  }),
);

/** Payout account state, shown alongside a transporter in the console. */
adminRouter.get(
  '/payouts',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const accounts = await TransporterPayoutAccount.find();
    const owners = await User.find({ _id: { $in: accounts.map((a) => a.userId) } }, 'name phone');
    ok(
      res,
      accounts.map((account) => ({
        userId: String(account.userId),
        owner: owners.find((o) => String(o._id) === String(account.userId))?.name ?? 'Unknown',
        payoutStatus: account.payoutStatus,
        bankAccountLast4: account.bankAccountLast4 ?? null,
        ifsc: account.ifsc ?? null,
      })),
    );
  }),
);

// ---------- 5. live operations (PROMPT_1 §13 A2) ----------

/**
 * One read that answers "what is happening right now, and what is wrong with it".
 *
 * Deliberately a single endpoint rather than four: the board polls, and four
 * independent polls would show four moments in time on one screen.
 */
adminRouter.get(
  '/live',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { stuckMinutes } = z
      .object({ stuckMinutes: z.coerce.number().int().min(1).max(1440).default(45) })
      .parse(req.query);

    const trips = await Trip.find({ state: { $in: ACTIVE_TRIP_STATES } }).sort({ createdAt: -1 });
    const tripIds = trips.map((t) => t._id);

    const [shipments, vehicles, openRequests] = await Promise.all([
      TripShipment.find({ tripId: { $in: tripIds } }).sort({ pickupSequence: 1 }),
      Vehicle.find(),
      TransportRequest.find({ state: { $in: ['OPEN', 'TRANSPORTER_INTERESTED'] } }).sort({
        createdAt: 1,
      }),
    ]);

    const [people, offers, capacities] = await Promise.all([
      User.find(
        {
          $or: [
            { _id: { $in: trips.map((t) => t.transporterId) } },
            { _id: { $in: shipments.map((s) => s.farmerId) } },
            { _id: { $in: vehicles.map((v) => v.ownerId) } },
            { _id: { $in: openRequests.map((r) => r.farmerId) } },
          ],
        },
        'name phone ratingAvg',
      ),
      TransporterOffer.find({ requestId: { $in: openRequests.map((r) => r._id) } }, 'requestId state'),
      capacitiesFor(trips),
    ]);

    const personOf = (id: unknown) => {
      const person = people.find((p) => String(p._id) === String(id));
      return person
        ? { _id: String(person._id), name: person.name, phone: person.phone, ratingAvg: person.ratingAvg }
        : null;
    };

    const liveTrips = trips.map((trip) => {
      const vehicle = vehicles.find((v) => String(v._id) === String(trip.vehicleId));
      const mine = shipments.filter((s) => String(s.tripId) === String(trip._id));
      const active = mine.filter((s) => s.state !== 'CANCELLED');
      // updatedAt is the last time anything on the trip moved — a state change, a
      // reallocation. It is the only "nothing is happening" signal that exists
      // without a separate event log.
      const idleFor = minutesSince(trip.get('updatedAt') as Date);

      return {
        _id: String(trip._id),
        state: trip.state,
        destination: trip.destination,
        routeDistanceKm: trip.routeDistanceKm,
        estimatedRouteCost: trip.estimatedRouteCost,
        pricingVersion: trip.pricingVersion,
        startedAt: trip.startedAt ?? null,
        createdAt: trip.get('createdAt'),
        updatedAt: trip.get('updatedAt'),
        minutesInState: idleFor,
        stuck: idleFor >= stuckMinutes,
        transporter: personOf(trip.transporterId),
        vehicle: vehicle
          ? {
              _id: String(vehicle._id),
              registrationNumber: vehicle.registrationNumber,
              vehicleType: vehicle.vehicleType,
              status: vehicle.status,
              capacityKg: vehicle.capacityKg,
              currentLocation: vehicle.currentLocation ?? null,
            }
          : null,
        capacity: capacities.get(String(trip._id)) ?? {
          totalKg: trip.totalCapacityKg,
          committedKg: 0,
          loadedKg: 0,
          availableKg: trip.totalCapacityKg,
        },
        poolSize: active.length,
        pickedUpCount: active.filter((s) => s.pickedUpAt).length,
        deliveredCount: active.filter((s) => s.deliveredAt).length,
        shipments: mine.map((shipment) => ({
          _id: String(shipment._id),
          state: shipment.state,
          cropType: shipment.cropType,
          quantityKg: shipment.quantityKg,
          pickup: shipment.pickup,
          pickupSequence: shipment.pickupSequence,
          allocatedPrice: shipment.allocatedPrice,
          finalPrice: shipment.finalPrice ?? null,
          soloPrice: shipment.soloPrice,
          pickedUpAt: shipment.pickedUpAt ?? null,
          deliveredAt: shipment.deliveredAt ?? null,
          farmer: personOf(shipment.farmerId),
          // never expose the pickup code — it is the driver's proof, and an
          // operator who can read it can move a load that was never handed over
        })),
      };
    });

    const busyVehicleIds = new Set(trips.map((t) => String(t.vehicleId)));

    ok(res, {
      generatedAt: new Date().toISOString(),
      stuckMinutes,
      trips: liveTrips,
      alerts: {
        // a trip nobody has touched: the driver stopped updating, or is stranded
        stuckTrips: liveTrips
          .filter((t) => t.stuck)
          .map((t) => ({
            _id: t._id,
            state: t.state,
            minutesInState: t.minutesInState,
            transporter: t.transporter?.name || 'Unknown',
            to: t.destination?.name ?? '',
            poolSize: t.poolSize,
          })),
        // capacity that is switched on and earning nothing
        idleVehicles: vehicles
          .filter((v) => v.status !== 'OFFLINE' && !busyVehicleIds.has(String(v._id)))
          .map((v) => ({
            _id: String(v._id),
            registrationNumber: v.registrationNumber,
            status: v.status,
            verificationStatus: v.verificationStatus,
            capacityKg: v.capacityKg,
            owner: personOf(v.ownerId)?.name || 'Unknown',
            minutesIdle: minutesSince(v.get('updatedAt') as Date),
          })),
        // the pool's failure mode: a farmer waiting with nobody claiming
        unclaimedRequests: openRequests
          .filter(
            (r) =>
              !offers.some(
                (o) => String(o.requestId) === String(r._id) && o.state === 'INTERESTED',
              ),
          )
          .map((r) => ({
            _id: String(r._id),
            farmer: personOf(r.farmerId)?.name || 'Unknown',
            cropType: r.cropType,
            quantityKg: r.quantityKg,
            from: r.pickup?.name ?? '',
            to: r.destination?.name ?? '',
            preferredDate: r.preferredDate,
            minutesOpen: minutesSince(r.get('createdAt') as Date),
          })),
      },
    });
  }),
);

// ---------- 6. billing & the pricing audit trail (PROMPT_1 §13 A3) ----------

/**
 * Settlements are per shipment, not per trip and not per request.
 *
 * Under the new domain one trip carries several farmers who are each billed
 * separately after their own load is delivered, so the shipment is the only unit
 * where "who owes what" is a single answer. A delivered shipment with no Payment
 * row yet is exactly what an operator is looking for, so shipments are the spine
 * and Payment is joined in — not the other way round.
 */
adminRouter.get(
  '/billing',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, tripId } = z
      .object({ status: z.enum(PAYMENT_STATUSES).optional(), tripId: z.string().optional() })
      .parse(req.query);

    const filter: Record<string, unknown> = {};
    if (tripId) filter.tripId = tripId;
    if (status) {
      // narrowed in the database rather than after the page limit, so the totals
      // below describe the whole filtered set and not just the first page
      const matching = await Payment.find({ status }, 'shipmentId');
      filter._id = { $in: matching.map((p) => p.shipmentId) };
    }

    const shipments = await TripShipment.find(filter).sort({ updatedAt: -1 }).limit(300);

    const [payments, trips, farmers] = await Promise.all([
      Payment.find({ shipmentId: { $in: shipments.map((s) => s._id) } }),
      Trip.find({ _id: { $in: shipments.map((s) => s.tripId) } }, 'state destination pricingVersion'),
      User.find({ _id: { $in: shipments.map((s) => s.farmerId) } }, 'name phone'),
    ]);

    const settlements = shipments.map((shipment) => {
      const payment = payments.find((p) => String(p.shipmentId) === String(shipment._id));
      const farmer = farmers.find((f) => String(f._id) === String(shipment.farmerId));
      const trip = trips.find((t) => String(t._id) === String(shipment.tripId));
      const billed = shipment.finalPrice ?? shipment.allocatedPrice;

      return {
        shipmentId: String(shipment._id),
        tripId: String(shipment.tripId),
        requestId: String(shipment.requestId),
        farmer: farmer
          ? { _id: String(farmer._id), name: farmer.name, phone: farmer.phone }
          : null,
        cropType: shipment.cropType,
        quantityKg: shipment.quantityKg,
        shipmentState: shipment.state,
        allocatedPrice: shipment.allocatedPrice,
        finalPrice: shipment.finalPrice ?? null,
        soloPrice: shipment.soloPrice,
        // the number the farmer actually cares about: pooling versus going alone
        saved: Math.max(0, Math.round(shipment.soloPrice - billed)),
        deliveredAt: shipment.deliveredAt ?? null,
        trip: trip
          ? {
              _id: String(trip._id),
              state: trip.state,
              to: trip.destination?.name ?? '',
              pricingVersion: trip.pricingVersion,
            }
          : null,
        payment: payment
          ? {
              _id: String(payment._id),
              amount: payment.amount,
              status: payment.status,
              platformFee: payment.platformFee,
              transporterPayoutAmount: payment.transporterPayoutAmount,
              transferId: payment.transferId ?? null,
              // no transfer row at all is a different problem from a failed one
              transferStatus: payment.transferStatus ?? (payment.transferId ? 'CREATED' : null),
              razorpayOrderId: payment.razorpayOrderId ?? null,
              capturedAt: payment.capturedAt ?? null,
              createdAt: payment.get('createdAt'),
            }
          : null,
      };
    });

    ok(res, {
      settlements,
      totals: {
        billed: Math.round(
          settlements.reduce((sum, s) => sum + (s.finalPrice ?? s.allocatedPrice), 0),
        ),
        collected: Math.round(
          settlements
            .filter((s) => s.payment?.status === 'PAID')
            .reduce((sum, s) => sum + (s.payment?.amount ?? 0), 0),
        ),
        awaitingPayment: settlements.filter(
          (s) => s.shipmentState === 'PAYMENT_PENDING' || s.payment?.status === 'CREATED',
        ).length,
        paidOut: Math.round(
          settlements
            .filter((s) => s.payment?.transferId)
            .reduce((sum, s) => sum + (s.payment?.transporterPayoutAmount ?? 0), 0),
        ),
        awaitingTransfer: settlements.filter(
          (s) => s.payment?.status === 'PAID' && !s.payment.transferId,
        ).length,
        totalSaved: Math.round(settlements.reduce((sum, s) => sum + s.saved, 0)),
      },
      // the trips present in this result set, so the console can offer an audit
      // trail without a second listing endpoint
      trips: [...new Map(settlements.filter((s) => s.trip).map((s) => [s.tripId, s.trip!])).values()],
    });
  }),
);

/**
 * Why a farmer's price changed — the append-only receipt (PROMPT_2 §22).
 *
 * The mobile route is scoped to trip participants; an operator answering a
 * "why did my price go up" call is neither, so the console needs its own read.
 */
adminRouter.get(
  '/trips/:id/pricing',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const trip = await Trip.findById(req.params.id);
    if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

    const [events, shipments, transporter] = await Promise.all([
      PricingEvent.find({ tripId: trip._id }).sort({ version: -1 }).limit(50),
      TripShipment.find({ tripId: trip._id }, 'farmerId quantityKg cropType state'),
      User.findById(trip.transporterId, 'name phone'),
    ]);

    const farmers = await User.find({ _id: { $in: shipments.map((s) => s.farmerId) } }, 'name');
    const farmerName = (id: unknown): string =>
      farmers.find((f) => String(f._id) === String(id))?.name || 'Unknown farmer';

    ok(res, {
      trip: {
        _id: String(trip._id),
        state: trip.state,
        to: trip.destination?.name ?? '',
        routeDistanceKm: trip.routeDistanceKm,
        estimatedRouteCost: trip.estimatedRouteCost,
        pricingVersion: trip.pricingVersion,
        transporter: transporter ? { name: transporter.name, phone: transporter.phone } : null,
        poolSize: shipments.filter((s) => s.state !== 'CANCELLED').length,
      },
      events: events.map((event) => ({
        _id: String(event._id),
        version: event.version,
        reason: event.reason,
        routeDistanceKm: event.routeDistanceKm,
        routeCost: event.routeCost,
        totalQuantityKg: event.totalQuantityKg,
        createdAt: event.get('createdAt'),
        allocations: event.allocations.map((a) => ({
          shipmentId: String(a.shipmentId),
          farmerId: String(a.farmerId),
          farmerName: farmerName(a.farmerId),
          quantityKg: a.quantityKg ?? 0,
          amount: a.amount,
          previousAmount: a.previousAmount ?? null,
          // signed, so the table can say "went up" without recomputing it twice
          delta: a.previousAmount == null ? null : Math.round(a.amount - a.previousAmount),
        })),
      })),
    });
  }),
);

// ---------- 9. bookings — every request, and what became of it ----------

/**
 * The operator's view of the demand side. Deliberately reports the two pooling
 * states separately: `offerCount` is how many transporters ACCEPTED (which
 * reserves nothing) and `shipment` is set only once the farmer CONFIRMED one.
 * Collapsing them would hide exactly the failure an operator needs to spot —
 * requests with plenty of acceptances that no farmer ever confirmed.
 */
adminRouter.get(
  '/requests',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { state, q } = z
      .object({ state: z.string().optional(), q: z.string().optional() })
      .parse(req.query);

    const filter: Record<string, unknown> = {};
    if (state) filter.state = state;

    const requests = await TransportRequest.find(filter).sort({ createdAt: -1 }).limit(300);
    const ids = requests.map((request) => request._id);

    const [farmers, offers, shipments] = await Promise.all([
      User.find({ _id: { $in: requests.map((request) => request.farmerId) } }, 'name phone'),
      TransporterOffer.find({ requestId: { $in: ids } }, 'requestId state transporterId'),
      TripShipment.find({ requestId: { $in: ids } }, 'requestId tripId state allocatedPrice finalPrice soloPrice'),
    ]);

    const farmerById = new Map(farmers.map((farmer) => [String(farmer._id), farmer]));
    const needle = q?.trim().toLowerCase();

    const rows = requests
      .map((request) => {
        const id = String(request._id);
        const mine = offers.filter((offer) => String(offer.requestId) === id);
        const shipment = shipments.find((item) => String(item.requestId) === id) ?? null;
        const farmer = farmerById.get(String(request.farmerId));

        return {
          _id: id,
          state: request.state,
          cropType: request.cropType,
          quantityKg: request.quantityKg,
          from: request.pickup.name,
          to: request.destination.name,
          preferredDate: request.preferredDate,
          createdAt: request.get('createdAt') as Date,
          minutesOpen: minutesSince(request.get('createdAt') as Date),
          farmer: farmer ? { _id: String(farmer._id), name: farmer.name, phone: farmer.phone } : null,
          /** transporters who accepted — none of this is reserved capacity */
          offerCount: mine.filter((offer) => offer.state === 'INTERESTED').length,
          totalOffers: mine.length,
          /** set only when the farmer confirmed one of them */
          shipment: shipment
            ? {
                _id: String(shipment._id),
                tripId: String(shipment.tripId),
                state: shipment.state,
                price: shipment.finalPrice ?? shipment.allocatedPrice,
                soloPrice: shipment.soloPrice,
              }
            : null,
        };
      })
      .filter(
        (row) =>
          !needle ||
          row.cropType.toLowerCase().includes(needle) ||
          row.to.toLowerCase().includes(needle) ||
          (row.farmer?.name ?? '').toLowerCase().includes(needle),
      );

    ok(res, {
      requests: rows,
      totals: {
        total: rows.length,
        open: rows.filter((row) => row.state === 'OPEN').length,
        /** accepted by someone, still waiting on the farmer — the funnel's weak point */
        awaitingFarmer: rows.filter((row) => row.state === 'TRANSPORTER_INTERESTED').length,
        confirmed: rows.filter((row) => row.state === 'CONFIRMED').length,
        cancelled: rows.filter((row) => row.state === 'CANCELLED' || row.state === 'EXPIRED').length,
      },
    });
  }),
);

// ---------- 10. mandis — demand by destination ----------

/**
 * Derived from real requests and trips rather than a static list, so the board
 * reflects where produce is actually going.
 */
adminRouter.get(
  '/mandis',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [requests, trips, shipments] = await Promise.all([
      TransportRequest.find({}, 'destination state quantityKg'),
      Trip.find({}, 'destination state'),
      TripShipment.find({}, 'tripId quantityKg state allocatedPrice finalPrice soloPrice'),
    ]);

    const shipmentsByTrip = new Map<string, typeof shipments>();
    for (const shipment of shipments) {
      const key = String(shipment.tripId);
      shipmentsByTrip.set(key, [...(shipmentsByTrip.get(key) ?? []), shipment]);
    }

    const byName = new Map<
      string,
      {
        name: string;
        lat: number;
        lng: number;
        requests: number;
        openRequests: number;
        trips: number;
        activeTrips: number;
        tonnes: number;
        revenue: number;
        saved: number;
      }
    >();

    const entry = (name: string, lat: number, lng: number) => {
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          lat,
          lng,
          requests: 0,
          openRequests: 0,
          trips: 0,
          activeTrips: 0,
          tonnes: 0,
          revenue: 0,
          saved: 0,
        });
      }
      return byName.get(name)!;
    };

    for (const request of requests) {
      const row = entry(
        request.destination.name,
        request.destination.lat ?? 0,
        request.destination.lng ?? 0,
      );
      row.requests += 1;
      if (request.state === 'OPEN' || request.state === 'TRANSPORTER_INTERESTED') row.openRequests += 1;
    }

    for (const trip of trips) {
      const row = entry(trip.destination.name, trip.destination.lat ?? 0, trip.destination.lng ?? 0);
      row.trips += 1;
      if (ACTIVE_TRIP_STATES.includes(trip.state as TripState)) row.activeTrips += 1;

      for (const shipment of shipmentsByTrip.get(String(trip._id)) ?? []) {
        row.tonnes += shipment.quantityKg / 1000;
        const price = shipment.finalPrice ?? shipment.allocatedPrice;
        row.revenue += price;
        row.saved += Math.max(0, shipment.soloPrice - price);
      }
    }

    ok(
      res,
      [...byName.values()]
        .map((row) => ({
          ...row,
          tonnes: Math.round(row.tonnes * 10) / 10,
          revenue: Math.round(row.revenue),
          saved: Math.round(row.saved),
        }))
        .sort((a, b) => b.requests - a.requests),
    );
  }),
);

// ---------- 11. Servo AI activity ----------

/**
 * What the assistant is actually being used for. Language mix matters most: the
 * whole reason Servo exists is farmers who would not otherwise use the app.
 */
adminRouter.get(
  '/ai',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const sessions = await AiSession.find({}).sort({ updatedAt: -1 }).limit(200);
    const users = await User.find(
      { _id: { $in: sessions.map((session) => session.userId) } },
      'name role',
    );
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const byLanguage: Record<string, number> = {};
    let turns = 0;
    let awaitingConfirmation = 0;

    for (const session of sessions) {
      const language = session.detectedLanguage ?? 'en';
      byLanguage[language] = (byLanguage[language] ?? 0) + 1;
      turns += session.history.length;
      if (session.pendingConfirmation) awaitingConfirmation += 1;
    }

    ok(res, {
      totals: {
        sessions: sessions.length,
        turns,
        awaitingConfirmation,
        avgTurns: sessions.length ? Math.round((turns / sessions.length) * 10) / 10 : 0,
      },
      byLanguage,
      recent: sessions.slice(0, 40).map((session) => {
        const last = session.history[session.history.length - 1];
        const user = userById.get(String(session.userId));
        return {
          _id: String(session._id),
          user: user ? { name: user.name, role: user.role } : null,
          language: session.detectedLanguage ?? 'en',
          turns: session.history.length,
          lastMessage: last ? last.content.slice(0, 160) : null,
          lastRole: last?.role ?? null,
          pending: session.pendingConfirmation?.tool ?? null,
          updatedAt: session.get('updatedAt') as Date,
        };
      }),
    });
  }),
);
