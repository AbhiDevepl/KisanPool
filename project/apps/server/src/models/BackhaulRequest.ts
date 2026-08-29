import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { BACKHAUL_REQUEST_STATES, CARGO_CATEGORIES } from '@kisanpool/shared';

/**
 * Something that needs carrying in the direction vehicles come home empty (ADR-039).
 *
 * Deliberately NOT a TransportRequest. That model is about a farmer's produce
 * going to a mandi: it requires a crop type, it is pooled and compared across
 * several transporters who claim it, and its lifecycle ends when the farmer picks
 * one. A return load has none of that. It has no crop, it usually comes from a
 * shopkeeper or an input dealer rather than a farmer, and it is taken by the ONE
 * driver who is already heading that way — there is nothing to compare.
 *
 * `requesterId` is any signed-in user. That is the smallest extensible
 * abstraction the brief asks for: it lets a farmer send crates home today and a
 * local business post stock tomorrow, without a second marketplace, a new role,
 * or a change to ADR-002.
 */
const backhaulRequestSchema = new Schema(
  {
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** gates which vehicle types may take it — see CARGO_RULES in shared/backhaul */
    cargoCategory: { type: String, enum: CARGO_CATEGORIES, required: true, index: true },
    description: { type: String, required: true },
    weightKg: { type: Number, required: true, min: 1 },

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

    /**
     * The collection window.
     *
     * Backhaul only works when timing lines up: a driver reaching the mandi at
     * 2pm can take a load ready between noon and 6pm and cannot take one ready
     * tomorrow. Matching filters on this before it scores anything.
     */
    readyFrom: { type: Date, required: true },
    readyUntil: { type: Date, required: true },

    state: { type: String, enum: BACKHAUL_REQUEST_STATES, default: 'OPEN', index: true },

    /** what the requester says they will pay; the engine quotes independently */
    offeredPrice: { type: Number, default: undefined, min: 0 },
    notes: { type: String, default: undefined },

    /** set when a driver takes it onto their return leg */
    bookedAt: { type: Date, default: undefined },
    cancelledAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

// the matching query: open loads whose window is still live
backhaulRequestSchema.index({ state: 1, readyUntil: 1 });

export type BackhaulRequestAttrs = InferSchemaType<typeof backhaulRequestSchema>;
export type BackhaulRequestDoc = HydratedDocument<BackhaulRequestAttrs>;
export const BackhaulRequest = model('BackhaulRequest', backhaulRequestSchema);
