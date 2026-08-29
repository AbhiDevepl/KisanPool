import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYOUT_STATUSES } from '@kisanpool/shared';

/**
 * Razorpay Route linked account. We persist Razorpay's ids, never the raw bank
 * instrument — PAN, account number and IFSC go straight to Razorpay (ADR-007).
 */
const payoutAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    razorpayContactId: { type: String, default: undefined },
    razorpayFundAccountId: { type: String, default: undefined },
    razorpayAccountId: { type: String, default: undefined },
    payoutStatus: { type: String, enum: PAYOUT_STATUSES, default: 'NOT_ONBOARDED' },
    /** the transporter withdraws to this UPI ID (ADR-038) */
    upiId: { type: String, default: undefined },
    // legacy bank fields — kept for old records, no longer collected
    bankAccountLast4: { type: String, default: undefined },
    ifsc: { type: String, default: undefined },
  },
  { timestamps: true },
);

export type PayoutAccountAttrs = InferSchemaType<typeof payoutAccountSchema>;
export type PayoutAccountDoc = HydratedDocument<PayoutAccountAttrs>;
export const TransporterPayoutAccount = model(
  'TransporterPayoutAccount',
  payoutAccountSchema,
);
