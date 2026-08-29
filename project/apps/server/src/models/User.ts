import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LANGUAGES, ROLES } from '@kisanpool/shared';

const geoPoint = new Schema(
  { name: String, lat: Number, lng: Number },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, default: '' },
    phone: { type: String, required: true, unique: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    language: { type: String, enum: LANGUAGES, default: 'en' },
    defaultLocation: { type: geoPoint, default: undefined },
    pushToken: { type: String, default: undefined },

    // derived from Rating documents — never written from a client payload
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // OTP state lives on the user: hashed, short-lived, no Redis for this (brief §10)
    otpHash: { type: String, default: undefined, select: false },
    otpExpiresAt: { type: Date, default: undefined, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpRequestedAt: { type: Date, default: undefined, select: false },
    otpRequestCount: { type: Number, default: 0, select: false },

    phoneVerifiedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);
