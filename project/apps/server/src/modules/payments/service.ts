import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import { money, toPaise } from '../../lib/geo';
import {
  Payment,
  Trip,
  TripShipment,
  TransporterPayoutAccount,
  Vehicle,
} from '../../models';
import { emitPaymentCaptured } from '../realtime';
import { notifyPaymentCaptured, notifyPayoutSent } from '../notifications/service';
import { creditEarning } from '../wallet/service';
import { platformFee, transporterEarning } from '../pooling/pricing';
import { razorpay, verifyCheckoutSignature } from './razorpay';

/**
 * Creates the Razorpay order for the farmer's share. The booking is NOT confirmed
 * here — capture is what confirms it (ADR-008).
 */
/**
 * Billing happens AFTER delivery now (ADR-031).
 *
 * It has to: the price is not knowable until the pool stops changing, because
 * every farmer who joins the route lowers everyone else's share. Charging upfront
 * would mean quoting a number we know will be wrong.
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

  const amount = shipment.finalPrice ?? shipment.allocatedPrice;
  const fee = platformFee(amount);

  const payment = await Payment.findOneAndUpdate(
    { shipmentId: shipment._id, status: { $in: ['CREATED', 'PAID'] } },
    {
      shipmentId: shipment._id,
      requestId: shipment.requestId,
      tripId: shipment.tripId,
      farmerId,
      amount,
      currency: 'INR',
      platformFee: fee,
      transporterPayoutAmount: transporterEarning(amount),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (payment.status === 'PAID') {
    throw new ApiError('BOOKING_STATE_INVALID', 'This load has already been paid for.');
  }

  if (!razorpay) {
    // demo mode — no Razorpay keys configured; the client's mock checkout still
    // exercises verify -> capture -> booking commit end to end
    payment.razorpayOrderId = `order_demo_${payment._id}`;
    await payment.save();
    return {
      razorpayOrderId: payment.razorpayOrderId,
      amount: toPaise(payment.amount),
      currency: 'INR',
      keyId: config.razorpay.keyId || 'demo',
      demo: true,
    };
  }

  try {
    const order = await razorpay.orders.create({
      amount: toPaise(payment.amount),
      currency: 'INR',
      receipt: String(payment._id),
      notes: { shipmentId: String(shipment._id), paymentId: String(payment._id) },
    });

    payment.razorpayOrderId = order.id;
    await payment.save();

    return {
      razorpayOrderId: order.id,
      amount: Number(order.amount),
      currency: 'INR',
      keyId: config.razorpay.keyId,
      demo: false,
    };
  } catch (err) {
    console.error('[payments] order creation failed', err);
    throw new ApiError('PAYMENT_FAILED', 'We could not start the payment. Please try again.');
  }
}

/**
 * Verifies the checkout signature, then captures. The webhook is still the source
 * of truth — this path just lets the app move on without waiting for it.
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

  const isDemo = args.orderId.startsWith('order_demo_');
  if (!isDemo && !verifyCheckoutSignature(args)) {
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

/**
 * The single place a payment becomes PAID and a booking commits. Called by both
 * /payments/verify and the webhook, and safe to run twice.
 */
export async function markCaptured(paymentId: string): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment) return;
  if (payment.status === 'PAID') return; // idempotent — webhook and callback both land here

  payment.status = 'PAID';
  payment.capturedAt = new Date();
  await payment.save();

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

  // the driver is paid out of this specific settled load
  if (payment.tripId && trip) {
    // credit their internal wallet — this is the balance they withdraw (ADR-038)
    try {
      await creditEarning(
        String(trip.transporterId),
        String(payment._id),
        payment.transporterPayoutAmount,
      );
    } catch (err) {
      console.warn('[payments] wallet credit deferred', err);
    }

    try {
      await payoutForPayment(String(payment._id));
    } catch (err) {
      console.warn('[payments] payout deferred', err);
    }
  }
}

export async function markFailed(paymentId: string): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status === 'PAID') return;
  payment.status = 'FAILED';
  await payment.save();
}

/**
 * Refund for the cancellation policy amount (docs/PRD.md §7). The fee percentage is
 * config, never a literal (ADR-013).
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
  if (payment.transferId) {
    throw new ApiError(
      'PAYMENT_REFUND_NOT_ALLOWED',
      'This trip has already been paid out. Please contact support.',
    );
  }

  const amount = money((payment.amount * refundPct) / 100);

  if (razorpay && payment.razorpayPaymentId && !payment.razorpayPaymentId.startsWith('pay_demo')) {
    try {
      const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: toPaise(amount),
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

  payment.refundAmount = amount;
  payment.status = refundPct >= 100 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await payment.save();

  return payment;
}

/**
 * Route transfer on delivery. Failure shows as "payout pending", never as an error
 * the driver must fix (docs/API_CONTRACTS.md §5).
 */
export async function payoutForPayment(paymentId: string): Promise<void> {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status !== 'PAID' || payment.transferId) return;

  const trip = payment.tripId ? await Trip.findById(payment.tripId) : null;
  if (!trip) return;
  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (!vehicle) return;

  const account = await TransporterPayoutAccount.findOne({ userId: trip.transporterId });
  if (!account || account.payoutStatus !== 'ACTIVE') {
    throw new ApiError(
      'PAYOUT_ACCOUNT_INACTIVE',
      'Add your PAN and bank details to receive payouts.',
    );
  }

  try {
    if (razorpay && payment.razorpayPaymentId && account.razorpayAccountId) {
      const transfer = await razorpay.payments.transfer(payment.razorpayPaymentId, {
        transfers: [
          {
            account: account.razorpayAccountId,
            amount: toPaise(payment.transporterPayoutAmount),
            currency: 'INR',
            notes: { paymentId: String(payment._id) },
          },
        ],
      } as never);
      const first = (transfer as unknown as { items?: Array<{ id: string; status: string }> })
        .items?.[0];
      payment.transferId = first?.id ?? `trf_${Date.now()}`;
      payment.transferStatus = first?.status ?? 'created';
    } else {
      payment.transferId = `trf_demo_${payment._id}`;
      payment.transferStatus = 'processed';
    }
    await payment.save();
    await notifyPayoutSent(String(trip.transporterId), payment.transporterPayoutAmount);
  } catch (err) {
    console.error('[payments] transfer failed', err);
    throw new ApiError(
      'PAYOUT_TRANSFER_FAILED',
      'The payout could not be sent yet. It will be retried automatically.',
    );
  }
}

