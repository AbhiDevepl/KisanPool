import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { TRIP_STATES } from '@kisanpool/shared';

/**
 * A shared vehicle journey to one mandi, carrying many farmers' produce.
 *
 * This is the object the old model was missing entirely: previously a
 * TransportRequest *was* the trip, so two farmers on one vehicle were two
 * unrelated bookings that each paid full fare. A Trip is what lets a route cost
 * be split (ADR-030).
 *
 * Capacity is NOT stored here. It is derived from the shipments on every read, so
 * there is exactly one source of truth and no counter to drift.
 */
const tripSchema = new Schema(
  {
    transporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },

    destination: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },

    state: { type: String, enum: TRIP_STATES, default: 'FORMING', index: true },

    totalCapacityKg: { type: Number, required: true },

    routeDistanceKm: { type: Number, default: 0 },
    estimatedRouteCost: { type: Number, default: 0 },

    /** bumped on every reallocation; every PricingEvent carries the version it produced */
    pricingVersion: { type: Number, default: 0 },

    /**
     * Set to the vehicle id while the trip is open, cleared when it closes.
     *
     * A unique sparse index on this is what makes "one open trip per vehicle" a
     * database guarantee rather than a hope. Without it two farmers could each
     * open their own trip on the same truck and both pass a per-trip capacity
     * check — 900kg + 900kg on a 1500kg tempo, each trip individually "fine".
     */
    openForVehicle: { type: Schema.Types.ObjectId, default: undefined },

    startedAt: { type: Date, default: undefined },
    completedAt: { type: Date, default: undefined },
    cancelledAt: { type: Date, default: undefined },
    cancelReason: { type: String, default: undefined },
  },
  { timestamps: true },
);

tripSchema.index({ transporterId: 1, state: 1 });
// one open trip per vehicle, enforced by the database
tripSchema.index({ openForVehicle: 1 }, { unique: true, sparse: true });

export type TripAttrs = InferSchemaType<typeof tripSchema>;
export type TripDoc = HydratedDocument<TripAttrs>;
export const Trip = model('Trip', tripSchema);
