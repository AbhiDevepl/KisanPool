import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SHIPMENT_STATES } from '@kisanpool/shared';

/**
 * One farmer's produce riding on a shared Trip.
 *
 * This is the join that makes pooling real: Trip 1..N TripShipment N..1 Farmer.
 * It carries its own lifecycle because a shipment is picked up, delivered and paid
 * for independently of the other farmers on the same vehicle (PROMPT_2 §16).
 */
const tripShipmentSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'TransportRequest',
      required: true,
      unique: true, // one request can only ever ride once
    },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    quantityKg: { type: Number, required: true },
    cropType: { type: String, required: true },
    pickup: {
      type: new Schema(
        { name: { type: String, default: '' }, lat: Number, lng: Number },
        { _id: false },
      ),
      required: true,
    },

    /** order the driver collects them in — recomputed when the pool changes */
    pickupSequence: { type: Number, default: 0 },

    state: { type: String, enum: SHIPMENT_STATES, default: 'ASSIGNED', index: true },

    /** current share of the route cost; moves every time the pool changes */
    allocatedPrice: { type: Number, required: true },
    /** frozen at delivery — what the farmer is actually billed */
    finalPrice: { type: Number, default: undefined },
    /** what this farmer would have paid alone; the delta is the pooled saving */
    soloPrice: { type: Number, required: true },

    /** the farmer reads this to the driver at pickup — proves the right load moved */
    pickupOtp: { type: String, required: true },

    pickedUpAt: { type: Date, default: undefined },
    deliveredAt: { type: Date, default: undefined },
    cancelledAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

tripShipmentSchema.index({ tripId: 1, state: 1 });

export type TripShipmentAttrs = InferSchemaType<typeof tripShipmentSchema>;
export type TripShipmentDoc = HydratedDocument<TripShipmentAttrs>;
export const TripShipment = model('TripShipment', tripShipmentSchema);
