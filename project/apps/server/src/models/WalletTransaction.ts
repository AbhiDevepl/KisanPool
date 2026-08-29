import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { WALLET_TXN_REASONS, WALLET_TXN_TYPES } from '@kisanpool/shared';

/**
 * The append-only ledger behind TransporterWallet. One row per balance change,
 * with the resulting balance captured for auditability.
 *
 * `paymentId` carries a unique partial index so a settled load can only ever be
 * credited to the wallet once, even if markCaptured runs twice.
 */
const walletTxnSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: WALLET_TXN_TYPES, required: true },
    reason: { type: String, enum: WALLET_TXN_REASONS, required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: undefined },
    withdrawalId: { type: Schema.Types.ObjectId, ref: 'Withdrawal', default: undefined },
  },
  { timestamps: true },
);

// one EARNING credit per payment — the idempotency guard for wallet top-ups
walletTxnSchema.index(
  { paymentId: 1 },
  { unique: true, partialFilterExpression: { paymentId: { $exists: true } } },
);

export type WalletTxnAttrs = InferSchemaType<typeof walletTxnSchema>;
export type WalletTxnDoc = HydratedDocument<WalletTxnAttrs>;
export const WalletTransaction = model('WalletTransaction', walletTxnSchema);
