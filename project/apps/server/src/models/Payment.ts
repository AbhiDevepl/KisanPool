import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYMENT_STATUSES } from '@kisanpool/shared';

const paymentSchema = new Schema(
  {
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'TransportRequest',
      required: true,
      index: true,
    },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** what is actually being paid for — one delivered load on a shared trip */
    shipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'TripShipment',
      required: true,
      unique: true,
      index: true,
    },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: undefined, index: true },

    razorpayOrderId: { type: String, default: undefined, index: true },
    razorpayPaymentId: { type: String, default: undefined },
    razorpaySignature: { type: String, default: undefined },

    amount: { type: Number, required: true }, // this farmer's final share, in rupees
    currency: { type: String, default: 'INR' },

    // PAID is set by the webhook, not the client callback (ADR-012)
    status: { type: String, enum: PAYMENT_STATUSES, default: 'CREATED' },

    platformFee: { type: Number, default: 0 },
    transporterPayoutAmount: { type: Number, default: 0 },
    transferId: { type: String, default: undefined },
    transferStatus: { type: String, default: undefined },

    refundId: { type: String, default: undefined },
    refundAmount: { type: Number, default: undefined },

    capturedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

export type PaymentAttrs = InferSchemaType<typeof paymentSchema>;
export type PaymentDoc = HydratedDocument<PaymentAttrs>;
export const Payment = model('Payment', paymentSchema);
