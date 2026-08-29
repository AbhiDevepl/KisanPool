import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import { money } from '../../lib/geo';
import { paiseToRupees, platformSplit, rupeesToPaise } from '../../lib/money';
import { MIN_TRANSFER_PAISE, type PayoutState } from '@kisanpool/shared';
import {
  Payment,
  Trip,
  TripShipment,
  TransporterPayoutAccount,
  Vehicle,
} from '../../models';
import type { PaymentDoc, PayoutAccountDoc } from '../../models';
import { emitPaymentCaptured } from '../realtime';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';
import { notifyPaymentCaptured, notifyPayoutSent } from '../notifications/service';
import {
  isRouteAccountId,
  orderTransfer,
  razorpay,
  reverseTransfer,
  transferOnPayment,
  verifyCheckoutSignature,
} from './razorpay';

/**
 * Payments and Route settlement (ADR-043).
 *
 * THE BOUNDARY THIS MODULE SITS ON
 * --------------------------------
 * The pooled pricing engine (ADR-035) is the only thing that decides what a
 * farmer owes. Nothing here recomputes it — `authoritativeAmount()` reads the
 * shipment's frozen bill and stops. This module's whole job is to take that
 * decided number and move it: collect it, split it in integer paise, transfer the
 * transporter's part, and record what Razorpay charged for doing so.
 *
 * WHY THE MONEY WORKS IN PAISE
 * ----------------------------
 * ₹3,672.84 at 10% is ₹367.284, which is not an amount. The split rounds the
 * platform's cut and gives the transporter the exact remainder, so the two parts
 * always sum to the whole (packages/shared/src/payments.ts). Every Razorpay call
 * is made from those integers.
 *
 * WHAT IS DELIBERATELY SEPARATE
 * -----------------------------
 * `Payment.status` is about the FARMER'S money arriving. `Payment.payoutState` is
 * about the TRANSPORTER'S money leaving. They fail independently — a Route
 * transfer can fail against a perfectly captured payment — and collapsing them
 * would mean either re-charging a farmer for a payout problem or reporting a
 * driver as paid when they are not.
 */

// ---------------------------------------------------------------------------
// the amount — read, never recomputed
// ---------------------------------------------------------------------------

/**
 * What this farmer owes, according to the pricing engine and nothing else.
 *
 * `finalPrice` is set when the load is delivered and the bill freezes; before
 * that `allocatedPrice` is the live share. Billing only happens after delivery
 * (ADR-031), so in practice this is the frozen number.
 */
const authoritativeAmount = (shipment: {
  finalPrice?: number | null;
  allocatedPrice: number;
}): number => shipment.finalPrice ?? shipment.allocatedPrice;

/**
 * Is this payment a simulated one?
 *
 * Demo ids carry an explicit `demo` marker that no Razorpay id ever has. The
 * check lives here in one place because it used to be three different prefix
 * tests in three functions (`order_demo_` in verify, `pay_demo` in refund and
 * payout), which is exactly the shape of thing that drifts until one path calls
 * the live API with a fake id (ADR-043).
 */
export function isDemoPayment(payment: {
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
}): boolean {
  if (!razorpay) return true; // no credentials at all
  return (
    Boolean(payment.razorpayOrderId?.startsWith('order_demo_')) ||
    Boolean(payment.razorpayPaymentId?.includes('demo'))
  );
}

/** True while a linked account is inside Razorpay's documented 24-hour cooling period. */
const COOLING_PERIOD_MS = 24 * 60 * 60 * 1000;
function inCoolingPeriod(account: PayoutAccountDoc): boolean {
  const created = account.linkedAccountCreatedAt;
  if (!created) return false;
  return Date.now() - new Date(created).getTime() < COOLING_PERIOD_MS;
}

/**
 * Can this account receive a Route transfer right now?
 *
 * Being ineligible is not an error the farmer or the driver should see mid-flow —
 * it means the payout waits as PENDING and is retried, which is why this returns
 * a reason rather than throwing.
 */
export function payoutEligibility(account: PayoutAccountDoc | null): {
  eligible: boolean;
  reason?: string;
} {
  if (!account) return { eligible: false, reason: 'No payout account has been set up yet.' };
  if (!account.razorpayAccountId) {
    return { eligible: false, reason: 'No Razorpay linked account on file.' };
  }
  /*
   * With real credentials the id must be a real Route linked account. A demo or
   * seeded placeholder would be rejected by Razorpay, so it is caught here as an
   * unfinished onboarding — which is what it is — rather than surfacing later as
   * a failed transfer the driver cannot act on.
   */
  if (razorpay && !isRouteAccountId(account.razorpayAccountId)) {
    return {
      eligible: false,
      reason: 'Payout account is not a live Razorpay linked account yet — finish onboarding.',
    };
  }
  if (account.payoutStatus !== 'ACTIVE') {
    return { eligible: false, reason: `Linked account is ${account.payoutStatus.toLowerCase()}.` };
  }
  if (inCoolingPeriod(account)) {
    return {
      eligible: false,
      reason: 'Linked account is inside its 24-hour cooling period; the payout will retry.',
    };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// order creation
// ---------------------------------------------------------------------------

/**
 * Creates the Razorpay order for the farmer's final share.
 *
 * Billing happens AFTER delivery (ADR-031): the price is not knowable until the
 * pool stops changing, because every farmer who joins lowers everyone else's
 * share. Charging upfront would mean quoting a number we know will be wrong.
 *
 * IDEMPOTENT. Calling it twice for the same shipment returns the SAME order — the
 * farmer tapping "Pay" twice, or retrying after a dropped response, must not
 * create two orders against one load.
 *
 * The transporter's Route transfer is attached to the order here when the linked
 * account is eligible, so Razorpay creates and settles it itself on capture and
 * there is no window where we hold money we already owe someone.
 */
export async function createOrderForShipment(shipmentId: string, farmerId: string) {
  const shipment = await TripShipment.findById(shipmentId);
  if (!shipment) throw new ApiError('RESOURCE_NOT_FOUND', 'That shipment no longer exists.');
  if (String(shipment.farmerId) !== farmerId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That shipment is not yours.');
  }
  if (shipment.state !== 'PAYMENT_PENDING') {
    throw new ApiError(
      'BOOKING_STATE_INVALID',
      'This load can be paid for once it has been delivered.',
    );
  }

  // the pricing engine's number, server-side — a client-supplied amount is never
  // read anywhere in this module
  const amount = authoritativeAmount(shipment);
  const split = platformSplit(amount);

  const trip = shipment.tripId ? await Trip.findById(shipment.tripId) : null;

  /*
   * One Payment row per shipment — `shipmentId` is uniquely indexed, so this is a
   * find-then-update rather than an upsert with a status filter. That earlier
   * shape looked idempotent and was not: once a payment went FAILED it no longer
   * matched, the upsert tried to INSERT a second row for the same shipment, the
   * unique index rejected it, and the farmer could never retry a failed payment
   * at all (ADR-043).
   */
  let payment = await Payment.findOne({ shipmentId: shipment._id });

  if (payment?.status === 'PAID') {
    throw new ApiError('BOOKING_STATE_INVALID', 'This load has already been paid for.');
  }
  if (payment && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
    throw new ApiError('BOOKING_STATE_INVALID', 'This load has already been refunded.');
  }

  const figures = {
    shipmentId: shipment._id,
    requestId: shipment.requestId,
    tripId: shipment.tripId,
    farmerId,
    amount: paiseToRupees(split.amountPaise),
    currency: 'INR',
    platformFee: paiseToRupees(split.platformFeePaise),
    transporterPayoutAmount: paiseToRupees(split.transporterPaise),
    amountPaise: split.amountPaise,
    platformFeePaise: split.platformFeePaise,
    transporterPayoutPaise: split.transporterPaise,
    platformFeePct: split.feePct,
    pricingVersion: trip?.pricingVersion ?? 0,
  };

  if (!payment) {
    payment = await Payment.create(figures);
  } else {
    payment.set(figures);
    if (payment.status === 'FAILED') {
      // a failed attempt is retryable: reopen the row and get a fresh order,
      // because Razorpay will not accept a new payment against the dead one
      payment.status = 'CREATED';
      payment.razorpayOrderId = undefined;
      payment.razorpayPaymentId = undefined;
      payment.razorpaySignature = undefined;
      payment.payoutState = 'PENDING';
      payment.transferMode = 'NONE';
    }
    await payment.save();
  }

  // idempotency: an order already exists for this payment, so hand back the same
  // one instead of opening a second order against the same load
  if (payment.razorpayOrderId) {
    return {
      razorpayOrderId: payment.razorpayOrderId,
      amount: payment.amountPaise,
      currency: 'INR' as const,
      keyId: config.razorpay.keyId || 'demo',
      demo: payment.razorpayOrderId.startsWith('order_demo_'),
    };
  }

  if (!razorpay) {
    /*
     * Demo mode — no Razorpay keys. The mock checkout still exercises
     * verify → capture → payout end to end, and every id is prefixed `demo` so
     * nothing downstream can mistake it for money that actually moved (ADR-043).
     */
    payment.razorpayOrderId = `order_demo_${payment._id}`;
    payment.transferMode = 'NONE';
    await payment.save();
    return {
      razorpayOrderId: payment.razorpayOrderId,
      amount: payment.amountPaise,
      currency: 'INR' as const,
      keyId: config.razorpay.keyId || 'demo',
      demo: true,
    };
  }

  // attach the Route transfer to the order when we can — Razorpay then creates
  // and settles it on capture without us holding the driver's money
  const account = trip
    ? await TransporterPayoutAccount.findOne({ userId: trip.transporterId })
    : null;
  const eligibility = payoutEligibility(account);
  const transfers =
    eligibility.eligible && account?.razorpayAccountId && split.transporterPaise >= MIN_TRANSFER_PAISE
      ? [
          orderTransfer({
            account: account.razorpayAccountId,
            amount: split.transporterPaise,
            notes: { shipmentId: String(shipment._id) },
          }),
        ].filter(Boolean)
      : [];

  const body = {
    amount: split.amountPaise,
    currency: 'INR',
    receipt: String(payment._id),
    notes: { shipmentId: String(shipment._id), paymentId: String(payment._id) },
  };

  let order: { id: string; amount: number | string } | null = null;
  let mode: 'ORDER' | 'NONE' = 'NONE';
  let payoutNote = transfers.length ? undefined : eligibility.reason;

  if (transfers.length) {
    try {
      order = await razorpay.orders.create({ ...body, transfers } as never);
      mode = 'ORDER';
    } catch (err) {
      /*
       * The transfer was rejected — a stale or malformed linked account id, an
       * account still in review, a Route eligibility problem.
       *
       * This must NOT stop the farmer paying. Their money and the driver's payout
       * are separate financial states (ADR-043), and a payout the driver has to
       * fix is no reason to refuse a delivered load's bill. So: retry the order
       * plainly, record why the transfer was dropped, and let the post-capture
       * PAYMENT transfer path pick the payout up once the account is usable.
       */
      payoutNote = `Order transfer rejected: ${(err as Error)?.message ?? 'unknown'}`;
      console.warn('[payments] order transfer rejected, falling back to post-capture transfer');
    }
  }

  if (!order) {
    try {
      order = await razorpay.orders.create(body as never);
    } catch (err) {
      console.error('[payments] order creation failed', (err as Error)?.message);
      throw new ApiError('PAYMENT_FAILED', 'We could not start the payment. Please try again.');
    }
  }

  payment.razorpayOrderId = order.id;
  payment.transferMode = mode;
  if (payoutNote) payment.lastTransferError = payoutNote;
  await payment.save();

  return {
    razorpayOrderId: order.id,
    amount: Number(order.amount),
    currency: 'INR' as const,
    keyId: config.razorpay.keyId,
    demo: false,
  };
}

/**
 * Verifies the checkout signature, then captures. The webhook is still the source
 * of truth — this path just lets the app move on without waiting for it (ADR-012).
 */
export async function verifyPayment(args: {
  orderId: string;
  paymentId: string;
  signature: string;
  farmerId: string;
}) {
  const payment = await Payment.findOne({ razorpayOrderId: args.orderId });
  if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'That payment could not be found.');
  if (String(payment.farmerId) !== args.farmerId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That payment is not yours.');
  }

  if (!isDemoPayment(payment) && !verifyCheckoutSignature(args)) {
    throw new ApiError(
      'PAYMENT_SIGNATURE_INVALID',
      'We could not verify this payment. Please contact support before trying again.',
    );
  }

  payment.razorpayPaymentId = args.paymentId;
  payment.razorpaySignature = args.signature;
  await payment.save();

  await markCaptured(String(payment._id));
  return Payment.findById(payment._id);
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * The single place a payment becomes PAID. Called by both `/payments/verify` and
 * the webhook, and safe to run twice — the `status === 'PAID'` guard is what makes
 * a redelivered `payment.captured` a no-op rather than a second payout.
 *
 * `fees` are Razorpay's own, taken from the captured payment entity when present.
 * They are recorded, never estimated: the gateway fee comes out of the platform's
 * balance and changes what KisanPool nets, but it is Razorpay's number to report.
 */
export async function markCaptured(
  paymentId: string,
  fees?: { feePaise?: number; taxPaise?: number },
): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment) return;

  if (fees?.feePaise != null) {
    payment.gatewayFeePaise = fees.feePaise;
    payment.gatewayTaxPaise = fees.taxPaise;
    await payment.save();
  }

  if (payment.status === 'PAID') return; // idempotent — webhook and callback both land here

  /*
   * Journalled (ADR-044). Note what this is NOT: it is not permission to consider
   * the money received. The provider's signed webhook is what makes a payment
   * real, and this event only records that we observed and applied it — so a
   * replay after an incident can confirm the state landed, never invent it.
   */
  const intent = await recordIntent({
    eventType: 'PAYMENT_STATE_CHANGED',
    entityType: 'Payment',
    entityId: String(payment._id),
    actorId: String(payment.farmerId),
    operationKey: operationKey('PAYMENT_STATE_CHANGED', String(payment._id), 'PAID'),
    payload: {
      toState: 'PAID',
      shipmentId: String(payment.shipmentId),
      amountPaise: payment.amountPaise,
      // the provider reference is the anchor reconciliation would verify against
      razorpayPaymentId: payment.razorpayPaymentId ?? null,
    },
  });

  payment.status = 'PAID';
  payment.capturedAt = new Date();
  await payment.save();
  await markCommitted(intent);

  // capture settles a delivered load; it no longer decides whether a booking
  // happens, because the farmer committed at selection time
  const shipment = await TripShipment.findById(payment.shipmentId);
  if (shipment && shipment.state === 'PAYMENT_PENDING') {
    shipment.state = 'PAID';
    await shipment.save();
  }

  emitPaymentCaptured({
    requestId: String(payment.requestId),
    paymentId: String(payment._id),
  });

  const trip = payment.tripId ? await Trip.findById(payment.tripId) : null;
  const recipients = [String(payment.farmerId), trip ? String(trip.transporterId) : ''].filter(
    Boolean,
  );
  await notifyPaymentCaptured(recipients, String(payment.tripId ?? payment.requestId));

  // the driver is paid out of this specific settled load. A payout problem must
  // never fail the capture — the farmer's money has arrived either way.
  if (payment.tripId) {
    try {
      await payoutForPayment(String(payment._id));
    } catch (err) {
      console.warn('[payments] payout deferred', (err as Error)?.message);
    }
  }
}

export async function markFailed(paymentId: string): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status === 'PAID') return;
  payment.status = 'FAILED';
  // a failed payment has nothing to pay out, and the farmer can simply retry:
  // the order is reusable and the trip/pool state is untouched
  payment.payoutState = 'NOT_APPLICABLE';
  await payment.save();
}

// ---------------------------------------------------------------------------
// payout
// ---------------------------------------------------------------------------

const setPayout = async (
  payment: PaymentDoc,
  state: PayoutState,
  patch: Partial<Record<string, unknown>> = {},
): Promise<void> => {
  /*
   * Journalled, because a payout state change is money leaving (ADR-044). The
   * key includes the target state AND the transfer id, so the same transfer
   * reaching PROCESSED twice is one event — a replay can never be read as a
   * second payout.
   */
  const transferId = String(patch.transferId ?? payment.transferId ?? '');
  const intent = await recordIntent({
    eventType: 'PAYOUT_STATE_CHANGED',
    entityType: 'Payment',
    entityId: String(payment._id),
    actorId: null,
    operationKey: operationKey('PAYOUT_STATE_CHANGED', String(payment._id), `${state}:${transferId}`),
    payload: {
      toState: state,
      transferId: transferId || null,
      transporterPayoutPaise: payment.transporterPayoutPaise,
    },
  });

  payment.payoutState = state;
  Object.assign(payment, patch);
  await payment.save();
  await markCommitted(intent);
};

/**
 * Move the transporter's share for one settled load.
 *
 * Three ways this can go, all of them normal:
 *
 *   ORDER mode   — Razorpay already created the transfer with the order and
 *                  settles it on capture. There is nothing to do here; the
 *                  `transfer.processed` webhook is what marks it done.
 *   PAYMENT mode — no transfer was attached at order time, so create one now
 *                  against the captured payment.
 *   PENDING      — the linked account is not payable yet (missing, inactive, or
 *                  inside its 24-hour cooling period). This is NOT a failure: the
 *                  payout waits and is retried.
 *
 * Guarded against double payment by `transferId` and by the payout state: a
 * transfer that already exists is never created again, however many times a
 * webhook is redelivered.
 */
export async function payoutForPayment(paymentId: string): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status !== 'PAID') return;

  // already transferred, or already handed to Razorpay with the order — either
  // way, creating another transfer would pay the driver twice
  if (payment.transferId) return;
  if (payment.transferMode === 'ORDER') {
    if (payment.payoutState === 'PENDING') await setPayout(payment, 'CREATED');
    return;
  }
  if (payment.payoutState === 'PROCESSED' || payment.payoutState === 'REVERSED') return;

  const trip = payment.tripId ? await Trip.findById(payment.tripId) : null;
  if (!trip) return;
  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (!vehicle) return;

  const account = await TransporterPayoutAccount.findOne({ userId: trip.transporterId });
  const eligibility = payoutEligibility(account);
  if (!eligibility.eligible || !account?.razorpayAccountId) {
    // hold, do not fail: the money is safely with the platform and the driver has
    // nothing to fix beyond finishing onboarding
    await setPayout(payment, 'PENDING', { lastTransferError: eligibility.reason });
    throw new ApiError(
      'PAYOUT_ACCOUNT_INACTIVE',
      eligibility.reason ?? 'Add your PAN and bank details to receive payouts.',
    );
  }

  if (payment.transporterPayoutPaise < MIN_TRANSFER_PAISE) {
    await setPayout(payment, 'NOT_APPLICABLE', {
      lastTransferError: 'Below the ₹1 minimum Razorpay will transfer.',
    });
    return;
  }

  payment.transferAttempts = (payment.transferAttempts ?? 0) + 1;

  try {
    const live =
      !isDemoPayment(payment) &&
      payment.razorpayPaymentId &&
      isRouteAccountId(account.razorpayAccountId);

    if (live && payment.razorpayPaymentId) {
      const transfer = await transferOnPayment(payment.razorpayPaymentId, {
        account: account.razorpayAccountId,
        amount: payment.transporterPayoutPaise,
        notes: { shipmentId: String(payment.shipmentId) },
      });
      await setPayout(payment, transfer.status === 'processed' ? 'PROCESSED' : 'CREATED', {
        transferId: transfer.id,
        transferStatus: transfer.status,
        transferMode: 'PAYMENT',
        transferFeePaise: transfer.fees,
        transferTaxPaise: transfer.tax,
        transferredAt: transfer.status === 'processed' ? new Date() : undefined,
        lastTransferError: undefined,
      });
    } else {
      // demo mode — explicitly marked so no report can read it as real settlement
      await setPayout(payment, 'PROCESSED', {
        transferId: `trf_demo_${payment._id}`,
        transferStatus: 'processed',
        transferMode: 'PAYMENT',
        transferredAt: new Date(),
        lastTransferError: undefined,
      });
    }

    await notifyPayoutSent(String(trip.transporterId), payment.transporterPayoutAmount);
  } catch (err) {
    const message = (err as Error)?.message ?? 'transfer failed';
    console.error('[payments] transfer failed', message);
    // the driver is NOT paid, the farmer is NOT re-charged, and the delivered trip
    // stands. It is retryable.
    await setPayout(payment, 'FAILED', { lastTransferError: message });
    throw new ApiError(
      'PAYOUT_TRANSFER_FAILED',
      'The payout could not be sent yet. It will be retried automatically.',
    );
  }
}

/** Operator/reconciliation path: retry the payouts that are safe to retry. */
export async function retryPayout(paymentId: string): Promise<PaymentDoc | null> {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'That payment could not be found.');
  if (payment.transferId) return payment; // already transferred — never retry over it
  if (payment.status !== 'PAID') {
    throw new ApiError('BOOKING_STATE_INVALID', 'That payment has not been captured.');
  }
  // a FAILED transfer is retried by creating a fresh one against the payment
  if (payment.transferMode === 'ORDER' && payment.payoutState === 'FAILED') {
    payment.transferMode = 'PAYMENT';
    await payment.save();
  }
  await payoutForPayment(paymentId);
  return Payment.findById(paymentId);
}

/**
 * Reconcile a transfer from its webhook. The only place a payout becomes
 * PROCESSED for a real transfer, and it records Razorpay's transfer fee when the
 * event carries one.
 */
export async function reconcileTransfer(args: {
  transferId: string;
  status: string;
  feePaise?: number;
  taxPaise?: number;
  error?: string;
}): Promise<void> {
  const payment = await Payment.findOne({ transferId: args.transferId });
  if (!payment) return;

  const processed = args.status === 'processed';
  payment.transferStatus = args.status;
  payment.payoutState = processed ? 'PROCESSED' : args.status === 'failed' ? 'FAILED' : 'CREATED';
  if (processed) payment.transferredAt = payment.transferredAt ?? new Date();
  if (args.feePaise != null) payment.transferFeePaise = args.feePaise;
  if (args.taxPaise != null) payment.transferTaxPaise = args.taxPaise;
  if (args.error) payment.lastTransferError = args.error;
  await payment.save();
}

/**
 * A transfer created by Razorpay from the ORDER's `transfers[]` is not known to
 * us until its first webhook, so the event carries the linking information: the
 * transfer's source payment. This attaches it to our Payment row.
 */
export async function attachOrderTransfer(args: {
  razorpayPaymentId: string;
  transferId: string;
  status: string;
  amountPaise?: number;
  feePaise?: number;
  taxPaise?: number;
}): Promise<void> {
  const payment = await Payment.findOne({ razorpayPaymentId: args.razorpayPaymentId });
  if (!payment) return;
  if (payment.transferId && payment.transferId !== args.transferId) return; // never overwrite

  const processed = args.status === 'processed';
  payment.transferId = args.transferId;
  payment.transferStatus = args.status;
  payment.transferMode = payment.transferMode === 'NONE' ? 'ORDER' : payment.transferMode;
  payment.payoutState = processed ? 'PROCESSED' : args.status === 'failed' ? 'FAILED' : 'CREATED';
  if (processed) payment.transferredAt = payment.transferredAt ?? new Date();
  if (args.feePaise != null) payment.transferFeePaise = args.feePaise;
  if (args.taxPaise != null) payment.transferTaxPaise = args.taxPaise;
  await payment.save();

  if (processed) {
    const trip = payment.tripId ? await Trip.findById(payment.tripId) : null;
    if (trip) await notifyPayoutSent(String(trip.transporterId), payment.transporterPayoutAmount);
  }
}

// ---------------------------------------------------------------------------
// refunds
// ---------------------------------------------------------------------------

/**
 * Refund for the cancellation policy amount (docs/PRD.md §7). The fee percentage
 * is config, never a literal (ADR-013).
 *
 * If the transporter has already been transferred, the money is no longer in the
 * platform's balance to refund from — so the transfer is REVERSED first, which is
 * Razorpay's own mechanism for exactly this. A reversal that fails stops the
 * refund rather than leaving the books short (ADR-043).
 */
export async function refundPayment(
  paymentId: string,
  reason: string,
  refundPct = 100 - config.cancellationFeePct,
) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'That payment could not be found.');

  if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
    throw new ApiError('PAYMENT_REFUND_NOT_ALLOWED', 'There is no captured payment to refund.');
  }

  const refundPaise = Math.round((payment.amountPaise * refundPct) / 100);
  if (refundPaise <= 0) {
    throw new ApiError('PAYMENT_REFUND_NOT_ALLOWED', 'That refund would be nothing.');
  }

  // the transporter's share has to come back before it can be refunded out
  if (payment.transferId && payment.payoutState === 'PROCESSED') {
    // reverse only what the refund actually needs from the driver's share, capped
    // at what they were sent
    const reversePaise = Math.min(payment.transporterPayoutPaise, refundPaise);
    if (razorpay && !payment.transferId.startsWith('trf_demo_')) {
      try {
        const reversal = await reverseTransfer(payment.transferId, reversePaise);
        payment.reversalId = reversal.id;
      } catch (err) {
        console.error('[payments] reversal failed', (err as Error)?.message);
        throw new ApiError(
          'PAYMENT_REFUND_NOT_ALLOWED',
          'This trip has already been paid out and the reversal failed. Please contact support.',
        );
      }
    } else {
      payment.reversalId = `rvrsl_demo_${payment._id}`;
    }
    payment.reversedPaise = (payment.reversedPaise ?? 0) + reversePaise;
    payment.payoutState = 'REVERSED';
  }

  const amount = paiseToRupees(refundPaise);

  if (razorpay && payment.razorpayPaymentId && !isDemoPayment(payment)) {
    try {
      const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: refundPaise,
        notes: { reason },
      });
      payment.refundId = refund.id;
    } catch (err) {
      console.error('[payments] refund failed', err);
      throw new ApiError('PAYMENT_FAILED', 'The refund could not be processed. Please contact support.');
    }
  } else {
    payment.refundId = `rfnd_demo_${payment._id}`;
  }

  payment.refundPaise = refundPaise;
  payment.refundAmount = amount;
  payment.status = refundPct >= 100 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await payment.save();

  return payment;
}

/** Reconcile a refund from its webhook, so the record matches Razorpay's. */
export async function reconcileRefund(args: {
  razorpayPaymentId: string;
  refundId: string;
  amountPaise: number;
}): Promise<void> {
  const payment = await Payment.findOne({ razorpayPaymentId: args.razorpayPaymentId });
  if (!payment) return;
  payment.refundId = args.refundId;
  payment.refundPaise = args.amountPaise;
  payment.refundAmount = paiseToRupees(args.amountPaise);
  payment.status = args.amountPaise >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await payment.save();
}

// ---------------------------------------------------------------------------
// reconciliation view
// ---------------------------------------------------------------------------

/**
 * The four different things people call "the fee", kept apart.
 *
 * `netPlatformPaise` stays null while any Razorpay fee is still unknown, because
 * a net figure computed from a fee we have not been told is a guess wearing the
 * costume of an accounting record.
 */
export function settlementOf(payment: PaymentDoc) {
  const gateway =
    payment.gatewayFeePaise != null
      ? payment.gatewayFeePaise + (payment.gatewayTaxPaise ?? 0)
      : null;
  const transfer =
    payment.transferFeePaise != null
      ? payment.transferFeePaise + (payment.transferTaxPaise ?? 0)
      : null;

  return {
    amountPaise: payment.amountPaise,
    platformFeePaise: payment.platformFeePaise,
    transporterPaise: payment.transporterPayoutPaise,
    feePct: payment.platformFeePct,
    gatewayFeePaise: gateway,
    transferFeePaise: transfer,
    netPlatformPaise:
      gateway != null && transfer != null
        ? payment.platformFeePaise - gateway - transfer
        : null,
    payoutState: payment.payoutState as PayoutState,
    transferMode: payment.transferMode,
    transferId: payment.transferId ?? null,
    reversedPaise: payment.reversedPaise ?? 0,
  };
}

export { authoritativeAmount, rupeesToPaise, money };
