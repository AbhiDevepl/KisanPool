import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { WITHDRAWAL_STATUSES } from '@kisanpool/shared';

/**
 * A transporter's request to move wallet money to their UPI ID, and the
 * RazorpayX payout that fulfils it.
 *
 * `referenceId` is generated once and sent to RazorpayX as the idempotency key,
 * so a retried request can never trigger a second payout for the same money.
 * The wallet is debited BEFORE the payout call; a failed payout reverses it.
 */
const withdrawalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 }, // whole rupees
    upiId: { type: String, required: true },

    status: { type: String, enum: WITHDRAWAL_STATUSES, default: 'PENDING', index: true },

    referenceId: { type: String, required: true, unique: true },
    razorpayPayoutId: { type: String, default: undefined, index: true },
    razorpayPayoutStatus: { type: String, default: undefined },
    failureReason: { type: String, default: undefined },

    /** set once the wallet debit has been credited back after a failure */
    reversedAt: { type: Date, default: undefined },
    processedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

export type WithdrawalAttrs = InferSchemaType<typeof withdrawalSchema>;
export type WithdrawalDoc = HydratedDocument<WithdrawalAttrs>;
export const Withdrawal = model('Withdrawal', withdrawalSchema);
