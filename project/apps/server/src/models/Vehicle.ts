import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { VEHICLE_STATUSES, VEHICLE_TYPES, VERIFICATION_STATUSES } from '@kisanpool/shared';

const vehicleSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    registrationNumber: { type: String, default: '' },
    capacityKg: { type: Number, required: true },
    availableCapacityKg: { type: Number, required: true },
    currentLocation: {
      type: new Schema({ lat: Number, lng: Number }, { _id: false }),
      default: undefined,
    },
    ratePerKm: { type: Number, required: true },
    status: { type: String, enum: VEHICLE_STATUSES, default: 'OFFLINE' },

    // the KYC gate — matching filters on this, so no UI change can surface an
    // unverified vehicle (ADR-010)
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING' },
  },
  { timestamps: true },
);

vehicleSchema.index({ status: 1, verificationStatus: 1, availableCapacityKg: 1 });

export type VehicleAttrs = InferSchemaType<typeof vehicleSchema>;
export type VehicleDoc = HydratedDocument<VehicleAttrs>;
export const Vehicle = model('Vehicle', vehicleSchema);
