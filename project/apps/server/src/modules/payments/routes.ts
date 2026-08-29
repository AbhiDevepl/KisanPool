import { Router, raw } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { Payment, TransporterPayoutAccount, Trip, TripShipment, Vehicle } from '../../models';
import {
  createOrderForShipment,
  markCaptured,
  markFailed,
  payoutForPayment,
  refundPayment,
  verifyPayment,
} from './service';
import { verifyWebhookSignature } from './razorpay';
import { applyPayoutOutcome } from '../wallet/service';

export const paymentsRouter = Router();

/** Billing is per delivered shipment now, not per request (ADR-031). */
paymentsRouter.post(
  '/create-order',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { shipmentId } = z.object({ shipmentId: z.string() }).parse(req.body);
    ok(res, await createOrderForShipment(shipmentId, req.userId));
  }),
);

paymentsRouter.post(
  '/verify',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        razorpay_order_id: z.string(),
        razorpay_payment_id: z.string(),
        razorpay_signature: z.string(),
      })
      .parse(req.body);

    const payment = await verifyPayment({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
      farmerId: req.userId,
    });
    ok(res, payment);
  }),
);

paymentsRouter.post(
  '/refund',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { paymentId, reason } = z
      .object({ paymentId: z.string(), reason: z.string().min(1) })
      .parse(req.body);

    const payment = await Payment.findById(paymentId);
    if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'That payment could not be found.');
    if (String(payment.farmerId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That payment is not yours.');
    }
    ok(res, await refundPayment(paymentId, reason));
  }),
);

/** The farmer's passbook — payments, receipts, refund status. */
paymentsRouter.get(
  '/me',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const payments = await Payment.find({ farmerId: req.userId }).sort({ createdAt: -1 });
    const shipments = await TripShipment.find({
      _id: { $in: payments.map((p) => p.shipmentId) },
    });
    const byId = new Map(shipments.map((s) => [String(s._id), s]));

    ok(
      res,
      payments.map((p) => {
        const shipment = byId.get(String(p.shipmentId));
        return {
          payment: p,
          shipment: shipment
            ? {
                _id: String(shipment._id),
                cropType: shipment.cropType,
                quantityKg: shipment.quantityKg,
                from: shipment.pickup?.name ?? null,
                soloPrice: shipment.soloPrice,
                finalPrice: shipment.finalPrice ?? shipment.allocatedPrice,
              }
            : null,
        };
      }),
    );
  }),
);

// ---- transporter payouts ----

export const transportersRouter = Router();

/**
 * Payout onboarding is now just a UPI ID — the transporter's wallet is paid out
 * to it via RazorpayX. No bank account or IFSC is collected or stored (ADR-038).
 */
transportersRouter.post(
  '/payout-onboarding',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        upiId: z
          .string()
          .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'must be a valid UPI ID'),
      })
      .parse(req.body);

    const account = await TransporterPayoutAccount.findOneAndUpdate(
      { userId: req.userId },
      {
        userId: req.userId,
        upiId: body.upiId,
        payoutStatus: 'ACTIVE',
        // a UPI payout needs no linked bank account on our side
        razorpayAccountId: `acc_upi_${req.userId}`,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    ok(res, account, 201);
  }),
);

transportersRouter.get(
  '/payouts',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const vehicle = await Vehicle.findOne({ ownerId: req.userId });
    const account = await TransporterPayoutAccount.findOne({ userId: req.userId });

    if (!vehicle) {
      ok(res, { payouts: [], total: 0, account });
      return;
    }

    const trips = await Trip.find({ vehicleId: vehicle._id });
    const payments = await Payment.find({
      tripId: { $in: trips.map((t) => t._id) },
      status: { $in: ['PAID', 'PARTIALLY_REFUNDED'] },
    }).sort({ createdAt: -1 });

    const shipments = await TripShipment.find({
      _id: { $in: payments.map((p) => p.shipmentId) },
    });
    const byTrip = new Map(trips.map((t) => [String(t._id), t]));
    const byShipment = new Map(shipments.map((s) => [String(s._id), s]));

    const payouts = payments.map((p) => {
      const shipment = byShipment.get(String(p.shipmentId));
      const trip = byTrip.get(String(p.tripId));
      return {
        paymentId: String(p._id),
        shipmentId: String(p.shipmentId),
        tripId: String(p.tripId ?? ''),
        amount: p.transporterPayoutAmount,
        transferId: p.transferId ?? null,
        transferStatus: p.transferId ? (p.transferStatus ?? 'processed') : 'pending',
        createdAt: p.get('createdAt'),
        // the route this load actually rode
        from: shipment?.pickup?.name ?? null,
        to: trip?.destination?.name ?? null,
        cropType: shipment?.cropType ?? null,
        quantityKg: shipment?.quantityKg ?? null,
      };
    });

    ok(res, {
      payouts,
      total: payouts
        .filter((p) => p.transferId)
        .reduce((sum, p) => sum + p.amount, 0),
      account,
    });
  }),
);

// ---- webhook: the source of truth (ADR-012) ----

export const webhookRouter = Router();

/**
 * No JWT. Authenticated by verifying the signature over the RAW body, which is why
 * this router mounts its own raw parser before the app's JSON parser.
 */
webhookRouter.post(
  '/razorpay',
  raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body as Buffer;

    if (typeof signature !== 'string' || !Buffer.isBuffer(rawBody)) {
      throw new ApiError('PAYMENT_SIGNATURE_INVALID', 'Missing webhook signature.');
    }
    if (!verifyWebhookSignature(rawBody, signature)) {
      throw new ApiError('PAYMENT_SIGNATURE_INVALID', 'Webhook signature did not match.');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload: {
        payment?: { entity: { id: string; order_id: string } };
        transfer?: { entity: { id: string; status: string } };
        payout?: { entity: { id: string; status: string } };
      };
    };

    const orderId = event.payload.payment?.entity.order_id;

    switch (event.event) {
      case 'payment.captured': {
        const payment = orderId ? await Payment.findOne({ razorpayOrderId: orderId }) : null;
        if (payment) {
          payment.razorpayPaymentId = event.payload.payment?.entity.id;
          await payment.save();
          await markCaptured(String(payment._id));
        }
        break;
      }
      case 'payment.failed': {
        const payment = orderId ? await Payment.findOne({ razorpayOrderId: orderId }) : null;
        if (payment) await markFailed(String(payment._id));
        break;
      }
      case 'transfer.processed': {
        const transferId = event.payload.transfer?.entity.id;
        if (transferId) {
          await Payment.findOneAndUpdate(
            { transferId },
            { transferStatus: event.payload.transfer?.entity.status ?? 'processed' },
          );
        }
        break;
      }
      // RazorpayX wallet withdrawals (ADR-038)
      case 'payout.processed':
      case 'payout.failed':
      case 'payout.reversed':
      case 'payout.updated': {
        const payout = event.payload.payout?.entity;
        if (payout?.id) await applyPayoutOutcome(payout.id, payout.status);
        break;
      }
      default:
        break;
    }

    ok(res, { received: true });
  }),
);

export { payoutForPayment };
