import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYMENT_STATUSES, PAYOUT_STATES, TRANSFER_MODES } from '@kisanpool/shared';

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

    // ---- the commercial split, in rupees (what every screen already reads) ----
    platformFee: { type: Number, default: 0 },
    transporterPayoutAmount: { type: Number, default: 0 },

    /*
     * ---- the same split in INTEGER PAISE — the authoritative figures (ADR-043) ----
     *
     * Razorpay moves paise, and only in paise is "the parts sum to the whole"
     * true without a rounding caveat. The rupee fields above are derived from
     * these for display; these are what an order, a transfer and a reconciliation
     * are built from.
     */
    amountPaise: { type: Number, default: 0 },
    platformFeePaise: { type: Number, default: 0 },
    transporterPayoutPaise: { type: Number, default: 0 },
    /** the commission percentage this row was split at, so an old bill stays explainable */
    platformFeePct: { type: Number, default: 0 },
    /** the pricing version the amount was taken from — the reconciliation anchor */
    pricingVersion: { type: Number, default: 0 },

    // ---- Route transfer: its own lifecycle, not inferred from `status` ----
    transferId: { type: String, default: undefined, index: true },
    /** raw Razorpay transfer status string, kept verbatim for support */
    transferStatus: { type: String, default: undefined },
    payoutState: { type: String, enum: PAYOUT_STATES, default: 'PENDING', index: true },
    /** ORDER = Razorpay creates the transfer on capture; PAYMENT = we create it after */
    transferMode: { type: String, enum: TRANSFER_MODES, default: 'NONE' },
    transferAttempts: { type: Number, default: 0 },
    /** why the last transfer failed, so an operator can act without reading logs */
    lastTransferError: { type: String, default: undefined },
    transferredAt: { type: Date, default: undefined },

    /*
     * ---- Razorpay's OWN fees, recorded only when Razorpay reports them ----
     *
     * A gateway fee is charged on the whole capture and a Route transfer fee on
     * each transfer, both plus GST, and both come out of the PLATFORM's balance —
     * never the transporter's transfer, which lands gross
     * (razorpay.com/docs/payments/route/transfer-fees-example).
     *
     * These stay null until Razorpay tells us. Estimating them would put an
     * invented number in a financial record.
     */
    gatewayFeePaise: { type: Number, default: undefined },
    gatewayTaxPaise: { type: Number, default: undefined },
    transferFeePaise: { type: Number, default: undefined },
    transferTaxPaise: { type: Number, default: undefined },

    refundId: { type: String, default: undefined },
    refundAmount: { type: Number, default: undefined },
    refundPaise: { type: Number, default: undefined },
    /** a Route reversal, when a refund had to claw a processed transfer back */
    reversalId: { type: String, default: undefined },
    reversedPaise: { type: Number, default: 0 },

    capturedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

export type PaymentAttrs = InferSchemaType<typeof paymentSchema>;
export type PaymentDoc = HydratedDocument<PaymentAttrs>;
export const Payment = model('Payment', paymentSchema);
