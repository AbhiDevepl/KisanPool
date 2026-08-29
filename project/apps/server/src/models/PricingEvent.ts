import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * An append-only record of every price reallocation on a trip (PROMPT_2 §22).
 *
 * Prices move under farmers' feet as the pool grows — that is the point of the
 * product, but it is also exactly the kind of change that needs a receipt. Nothing
 * here is ever updated; a correction is a new event with a higher version.
 */
const pricingEventSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    version: { type: Number, required: true },
    /** why the recalculation happened, in words a support agent can read */
    reason: { type: String, required: true },

    routeDistanceKm: { type: Number, required: true },
    routeCost: { type: Number, required: true },
    totalQuantityKg: { type: Number, required: true },

    allocations: {
      type: [
        new Schema(
          {
            shipmentId: { type: Schema.Types.ObjectId, ref: 'TripShipment', required: true },
            farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            quantityKg: Number,
            amount: { type: Number, required: true },
            previousAmount: { type: Number, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

pricingEventSchema.index({ tripId: 1, version: -1 });

export type PricingEventAttrs = InferSchemaType<typeof pricingEventSchema>;
export type PricingEventDoc = HydratedDocument<PricingEventAttrs>;
export const PricingEvent = model('PricingEvent', pricingEventSchema);
