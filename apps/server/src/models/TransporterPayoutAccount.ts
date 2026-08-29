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
    /** the Route linked account, `acc_…` — the only id a transfer can target */
    razorpayAccountId: { type: String, default: undefined },
    payoutStatus: { type: String, enum: PAYOUT_STATUSES, default: 'NOT_ONBOARDED' },
    bankAccountLast4: { type: String, default: undefined },
    ifsc: { type: String, default: undefined },

    /**
     * When the linked account was created at Razorpay.
     *
     * A new linked account has a documented 24-hour cooling period before it can
     * receive a transfer (razorpay.com/docs/payments/route/linked-account), so a
     * payout attempted inside that window fails at Razorpay rather than at our
     * validation. Storing the timestamp lets us hold the transfer as PENDING and
     * retry, instead of surfacing a failure the driver cannot act on (ADR-043).
     */
    linkedAccountCreatedAt: { type: Date, default: undefined },
    /** set when Razorpay confirms the account is activated and payable */
    activatedAt: { type: Date, default: undefined },
    /** last error Razorpay gave for this account, for the support path */
    lastError: { type: String, default: undefined },
  },
  { timestamps: true },
);

export type PayoutAccountAttrs = InferSchemaType<typeof payoutAccountSchema>;
export type PayoutAccountDoc = HydratedDocument<PayoutAccountAttrs>;
export const TransporterPayoutAccount = model(
  'TransporterPayoutAccount',
  payoutAccountSchema,
);
