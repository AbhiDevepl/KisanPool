import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const ratingSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    /**
     * Ratings hang off the shipment, not the trip: a driver carrying four farmers
     * rates four people on one trip, so (trip, fromUser) is not unique.
     */
    shipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'TripShipment',
      required: true,
      index: true,
    },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  },
  { timestamps: true },
);

// one rating per direction per shipment — BOOKING_ALREADY_RATED
ratingSchema.index({ shipmentId: 1, fromUserId: 1 }, { unique: true });

export type RatingAttrs = InferSchemaType<typeof ratingSchema>;
export type RatingDoc = HydratedDocument<RatingAttrs>;
export const Rating = model('Rating', ratingSchema);
