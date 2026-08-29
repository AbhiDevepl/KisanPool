import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  BOOKING_OPERATOR_MODES,
  MACHINE_BOOKING_STATES,
  MACHINE_CATEGORIES,
  PRICING_UNITS,
} from '@kisanpool/shared';

/**
 * One hire of one machine, by one farmer, in one time window (ADR-038).
 *
 * These rows ARE the availability calendar. A machine is free for a window when no
 * booking in `OCCUPIES_SCHEDULE` overlaps it and no blackout covers it — derived
 * on every read, never counted into a field that can drift.
 *
 * Unlike V1's TransporterOffer, a REQUESTED booking **holds the slot**. A farmer
 * asking for a harvester on Tuesday morning wants that specific slot, and there is
 * nothing to pool or compare afterwards, so leaving it unheld would mean telling
 * two farmers the same morning is free and disappointing one of them later.
 */
const machineBookingSchema = new Schema(
  {
    machineId: { type: Schema.Types.ObjectId, ref: 'FarmMachine', required: true, index: true },
    /** denormalised from the machine so a provider's inbox is one query */
    providerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** copied at booking time — the machine's own category may be edited later */
    category: { type: String, enum: MACHINE_CATEGORIES, required: true },
    operatorMode: { type: String, enum: BOOKING_OPERATOR_MODES, required: true },

    window: {
      type: new Schema(
        { start: { type: Date, required: true }, end: { type: Date, required: true } },
        { _id: false },
      ),
      required: true,
    },

    /** the field, which is not necessarily the farmer's default location */
    location: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },

    workType: { type: String, default: undefined },
    /** required when the machine is priced PER_ACRE — validated in the service */
    areaAcres: { type: Number, default: undefined, min: 0 },
    notes: { type: String, default: undefined },

    state: { type: String, enum: MACHINE_BOOKING_STATES, default: 'REQUESTED', index: true },

    /**
     * The full quote, frozen at request time.
     *
     * A machine hire is one provider and one farmer, so unlike a pooled trip there
     * is nothing that can later re-split it — the price the farmer agreed to is the
     * price, and storing the working means a support agent can explain the bill
     * months later without recomputing anything.
     */
    quote: {
      type: new Schema(
        {
          unit: { type: String, enum: PRICING_UNITS, required: true },
          rate: { type: Number, required: true },
          billableUnits: { type: Number, required: true },
          workCost: { type: Number, required: true },
          travelKm: { type: Number, default: 0 },
          travelCost: { type: Number, default: 0 },
          minimumTopUp: { type: Number, default: 0 },
          total: { type: Number, required: true },
          platformFee: { type: Number, default: 0 },
          providerEarning: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      required: true,
    },

    /** set at completion — the work may have taken more or fewer hours than quoted */
    finalAmount: { type: Number, default: undefined },

    /** the farmer reads this out when the machine arrives; proves the right job started */
    startOtp: { type: String, required: true },

    confirmedAt: { type: Date, default: undefined },
    startedAt: { type: Date, default: undefined },
    completedAt: { type: Date, default: undefined },
    cancelledAt: { type: Date, default: undefined },
    cancelReason: { type: String, default: undefined },
    declineReason: { type: String, default: undefined },
  },
  { timestamps: true },
);

// the conflict query: everything on this machine that still holds time
machineBookingSchema.index({ machineId: 1, state: 1, 'window.start': 1, 'window.end': 1 });
machineBookingSchema.index({ farmerId: 1, createdAt: -1 });
machineBookingSchema.index({ providerId: 1, state: 1 });

export type MachineBookingAttrs = InferSchemaType<typeof machineBookingSchema>;
export type MachineBookingDoc = HydratedDocument<MachineBookingAttrs>;
export const MachineBooking = model('MachineBooking', machineBookingSchema);
