import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { BACKHAUL_BOOKING_STATES, CARGO_CATEGORIES } from '@kisanpool/shared';

/**
 * One return load riding one trip's return leg (ADR-039).
 *
 * The join that makes the return half real: Trip 1..N BackhaulBooking N..1
 * BackhaulRequest. A leg may carry several loads if capacity allows, and each is
 * picked up, delivered and billed on its own — the same shape as TripShipment on
 * the outbound side, for the same reason.
 *
 * Return capacity is derived by counting these, never stored. The outbound
 * shipments have all been delivered by the time a return leg opens, so the two
 * directions never compete for the same kilograms.
 */
const backhaulBookingSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'BackhaulRequest',
      required: true,
      unique: true, // one return load can only ever ride once
    },
    transporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** copied at booking time so eligibility can be audited after the fact */
    cargoCategory: { type: String, enum: CARGO_CATEGORIES, required: true },
    weightKg: { type: Number, required: true },

    pickup: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },
    destination: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },

    state: { type: String, enum: BACKHAUL_BOOKING_STATES, default: 'BOOKED', index: true },

    /** what the requester pays — quoted by the backhaul pricing path, not offered */
    price: { type: Number, required: true },
    /** what the driver keeps after the platform's cut */
    transporterEarning: { type: Number, required: true },
    /** km the homeward journey grew to carry this — the honest cost of the detour */
    detourKm: { type: Number, default: 0 },
    /** km this cargo actually rides */
    carryKm: { type: Number, default: 0 },

    /** the requester reads this out at collection, as farmers do on the outbound leg */
    pickupOtp: { type: String, required: true },

    pickedUpAt: { type: Date, default: undefined },
    deliveredAt: { type: Date, default: undefined },
    cancelledAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

backhaulBookingSchema.index({ tripId: 1, state: 1 });

export type BackhaulBookingAttrs = InferSchemaType<typeof backhaulBookingSchema>;
export type BackhaulBookingDoc = HydratedDocument<BackhaulBookingAttrs>;
export const BackhaulBooking = model('BackhaulBooking', backhaulBookingSchema);
