import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  MACHINE_CATEGORIES,
  MACHINE_STATUSES,
  OPERATOR_MODES,
  PRICING_UNITS,
} from '@kisanpool/shared';

/**
 * One hireable machine or farm service (ADR-038).
 *
 * The owner is a plain `User`, not a new role. That is the whole point of the
 * feature: the farmer who owns a tractor and uses it twenty days a year is the
 * provider we most want, and forcing them to hold a second account — or forcing
 * ADR-002's permanent role choice open — would have shut them out. Being a
 * provider is *owning a machine*, which is a fact about the data, not a claim in
 * a JWT.
 *
 * Availability is NOT stored here. It is derived from MachineBooking on every
 * read, the same way V1 derives vehicle capacity from its shipments (ADR-030), so
 * there is one source of truth and no calendar to drift out of step with the
 * bookings that are the real answer.
 */
const machineSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    category: { type: String, enum: MACHINE_CATEGORIES, required: true, index: true },
    /** the provider's own words — farmers search on these, not on the enum */
    title: { type: String, required: true },
    makeModel: { type: String, default: undefined },

    operatorMode: { type: String, enum: OPERATOR_MODES, default: 'WITH_OPERATOR' },
    /** implements the machine comes with — "rotavator", "trolley", "cage wheels" */
    attachments: { type: [String], default: [] },

    baseLocation: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },
    /** how far the provider will travel to a field; the service-area boundary */
    serviceRadiusKm: { type: Number, default: 25, min: 1, max: 200 },

    pricing: {
      type: new Schema(
        {
          unit: { type: String, enum: PRICING_UNITS, required: true },
          /** rupees per unit — the provider's number, never the platform's */
          rate: { type: Number, required: true, min: 1 },
          /** the provider will not turn out for less, however small the job */
          minimumCharge: { type: Number, default: 0, min: 0 },
          /** what it costs to bring the machine to the field, per km */
          travelRatePerKm: { type: Number, default: 0, min: 0 },
        },
        { _id: false },
      ),
      required: true,
    },

    status: { type: String, enum: MACHINE_STATUSES, default: 'LISTED', index: true },

    /**
     * Owner-declared windows the machine cannot be booked in — servicing, a
     * family wedding, their own harvest. Kept on the machine rather than as
     * booking rows because they are not jobs and must never appear in earnings.
     */
    blackouts: {
      type: [
        new Schema(
          {
            start: { type: Date, required: true },
            end: { type: Date, required: true },
            reason: { type: String, default: undefined },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /**
     * Bumped once per booking attempt, inside the booking transaction.
     *
     * Carries no meaning. It exists so two farmers requesting the same slot at the
     * same instant write the SAME document and one of them loses — each otherwise
     * only INSERTs its own booking, and MongoDB raises no conflict between two
     * inserts, so both would re-check against the same stale calendar and both
     * commit. Exactly the phantom-insert race ADR-033 found on Trip.
     */
    reservationSeq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// the discovery query: category near a point, listed only
machineSchema.index({ category: 1, status: 1 });
machineSchema.index({ ownerId: 1, status: 1 });

export type FarmMachineAttrs = InferSchemaType<typeof machineSchema>;
export type FarmMachineDoc = HydratedDocument<FarmMachineAttrs>;
export const FarmMachine = model('FarmMachine', machineSchema);
