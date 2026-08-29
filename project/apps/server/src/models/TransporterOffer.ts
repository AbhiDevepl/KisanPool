import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { OFFER_STATES } from '@kisanpool/shared';

/**
 * A transporter claiming interest in one farmer's request.
 *
 * This replaces the old system-generated `Match`. The difference is who takes the
 * initiative: matching used to rank vehicles *for* the farmer and the transporter
 * had no say. Now the request sits in a pool, transporters claim what suits their
 * route, and the farmer chooses among real claimants (PROMPT_1 §4, ADR-030).
 *
 * An offer is not a booking. Capacity is reserved only when the farmer selects.
 */
const transporterOfferSchema = new Schema(
  {
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'TransportRequest',
      required: true,
      index: true,
    },
    transporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    /** the trip this load would join — may already carry other farmers */
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: undefined },

    state: { type: String, enum: OFFER_STATES, default: 'INTERESTED', index: true },

    /** quoted at claim time from backend pricing; re-quoted if the pool moves */
    quotedPrice: { type: Number, required: true },
    soloPrice: { type: Number, required: true },

    pickupDistanceKm: { type: Number, required: true },
    detourKm: { type: Number, default: 0 },
    etaMinutes: { type: Number, default: 0 },

    /** optional note from the driver, e.g. "passing your village at 7am" */
    message: { type: String, default: undefined },

    withdrawnAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

// a transporter may claim a given request only once
transporterOfferSchema.index({ requestId: 1, transporterId: 1 }, { unique: true });

export type TransporterOfferAttrs = InferSchemaType<typeof transporterOfferSchema>;
export type TransporterOfferDoc = HydratedDocument<TransporterOfferAttrs>;
export const TransporterOffer = model('TransporterOffer', transporterOfferSchema);
