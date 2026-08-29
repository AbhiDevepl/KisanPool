import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * The transporter's internal earnings balance, in whole rupees.
 *
 * Every change to `balance` is mirrored by a WalletTransaction ledger row, and
 * balance is only ever moved with an atomic `$inc` (see modules/wallet/service).
 */
const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },
  },
  { timestamps: true },
);

export type WalletAttrs = InferSchemaType<typeof walletSchema>;
export type WalletDoc = HydratedDocument<WalletAttrs>;
export const TransporterWallet = model('TransporterWallet', walletSchema);
