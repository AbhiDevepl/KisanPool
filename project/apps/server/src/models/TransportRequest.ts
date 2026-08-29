import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { REQUEST_STATES } from '@kisanpool/shared';

const geoPoint = new Schema(
  { name: { type: String, default: '' }, lat: Number, lng: Number },
  { _id: false },
);

const transportRequestSchema = new Schema(
  {
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cropType: { type: String, required: true },
    quantityKg: { type: Number, required: true },
    pickup: { type: geoPoint, required: true },
    destination: { type: geoPoint, required: true },
    preferredDate: { type: Date, required: true },
    /** free-text extras the farmer typed — crates, fragile, help loading */
    notes: { type: String, default: undefined },

    /**
     * The REQUEST's own lifecycle and nothing else. Once a transporter is chosen,
     * the produce's story continues on TripShipment — a request is never picked up
     * or delivered, a shipment is (PROMPT_1 §8, PROMPT_2 §16).
     */
    state: { type: String, enum: REQUEST_STATES, default: 'OPEN', index: true },

    /** set when the farmer selects a transporter */
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: undefined },

    /** how long it stays in the pool before expiring unclaimed */
    expiresAt: { type: Date, default: undefined },

    cancelledAt: { type: Date, default: undefined },
    cancelReason: { type: String, default: undefined },
  },
  { timestamps: true },
);

export type TransportRequestAttrs = InferSchemaType<typeof transportRequestSchema>;
export type TransportRequestDoc = HydratedDocument<TransportRequestAttrs>;
export const TransportRequest = model('TransportRequest', transportRequestSchema);
