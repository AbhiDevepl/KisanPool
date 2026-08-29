import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * An APMC market placed on the map from the operator console (ADR-039).
 *
 * This replaces the static list the mobile app used to ship. `location` is a
 * GeoJSON Point with a 2dsphere index so the farmer's "nearby" query is a
 * `$near` on the database, not a scan.
 */
const mandiSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    crops: { type: [String], default: [] },
    active: { type: Boolean, default: true },

    // GeoJSON: coordinates are [lng, lat]
    geo: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    createdBy: { type: String, default: undefined }, // admin username
  },
  { timestamps: true },
);

mandiSchema.index({ geo: '2dsphere' });

export type MandiAttrs = InferSchemaType<typeof mandiSchema>;
export type MandiDoc = HydratedDocument<MandiAttrs>;
export const Mandi = model('Mandi', mandiSchema);
