import { Router, raw } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import {
  Payment,
  TransporterPayoutAccount,
  Trip,
  TripShipment,
  User,
  Vehicle,
  WebhookEvent,
} from '../../models';
import {
  attachOrderTransfer,
  createOrderForShipment,
  markCaptured,
  markFailed,
  payoutEligibility,
  payoutForPayment,
  reconcileRefund,
  reconcileTransfer,
  refundPayment,
  settlementOf,
} from './service';
import { verifyPayment } from './service';
import { createLinkedAccount, razorpay, verifyWebhookSignature } from './razorpay';
import { requireWritable } from '../resilience/guard';

export const paymentsRouter = Router();

/** Billing is per delivered shipment now, not per request (ADR-031). */
paymentsRouter.post(
  '/create-order',
  requireAuth,
  // money — never opened unless the authoritative store can record it (ADR-044)
  requireWritable,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { shipmentId } = z.object({ shipmentId: z.string() }).parse(req.body);
    ok(res, await createOrderForShipment(shipmentId, req.userId));
  }),
);

paymentsRouter.post(
  '/verify',
  requireAuth,
  requireWritable,
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
  requireWritable,
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

transportersRouter.post(
  '/payout-onboarding',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        panNumber: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'must be a valid PAN'),
        bankAccountNumber: z.string().min(6).max(20),
        ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'must be a valid IFSC'),
        name: z.string().min(1).optional(),
      })
      .parse(req.body);

    /*
     * PAN, account number and IFSC go to Razorpay; we keep only their ids (ADR-007).
     *
     * This creates a ROUTE LINKED ACCOUNT. It previously called
     * `customers.create`, which creates a customer — an entity that can never
     * receive a transfer — so the id stored as `razorpayAccountId` would have
     * been rejected by the very first real Route transfer (ADR-043).
     *
     * A new linked account is PENDING, never ACTIVE: Razorpay has to verify the
     * bank account and there is a documented 24-hour cooling period before it can
     * be transferred to. Marking it ACTIVE here would have made every payout in
     * that window fail at Razorpay instead of waiting safely.
     */
    let razorpayAccountId: string | undefined;
    let payoutStatus: 'PENDING' | 'ACTIVE' = 'PENDING';
    let linkedAccountCreatedAt: Date | undefined;

    if (razorpay) {
      try {
        const user = await User.findById(req.userId);
        const created = await createLinkedAccount({
          name: body.name ?? user?.name ?? 'KisanPool Transporter',
          email: `transporter.${req.userId}@kisanpool.invalid`,
          phone: user?.phone ?? '',
          referenceId: req.userId,
        });
        razorpayAccountId = created.accountId;
        linkedAccountCreatedAt = new Date();
      } catch (err) {
        // never log the request body — it carries PAN and a bank account number
        console.error('[payouts] linked account creation failed', (err as Error)?.message);
        throw new ApiError(
          'EXTERNAL_SERVICE_ERROR',
          'We could not set up your payout account. Please try again.',
        );
      }
    } else {
      // demo mode: payable immediately so the end-to-end flow stays runnable, and
      // unmistakably fake so nothing reads it as a real settlement
      razorpayAccountId = `acc_demo_${req.userId}`;
      payoutStatus = 'ACTIVE';
    }

    const account = await TransporterPayoutAccount.findOneAndUpdate(
      { userId: req.userId },
      {
        userId: req.userId,
        razorpayAccountId,
        payoutStatus,
        linkedAccountCreatedAt,
        bankAccountLast4: body.bankAccountNumber.slice(-4),
        ifsc: body.ifsc,
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
        /** the driver's gross share — what Razorpay transfers, before Razorpay's own fees */
        amount: p.transporterPayoutAmount,
        transferId: p.transferId ?? null,
        transferStatus: p.transferId ? (p.transferStatus ?? 'processed') : 'pending',
        /** the payout's OWN state, which is not the payment's state (ADR-043) */
        payoutState: p.payoutState,
        /** why it has not gone out yet, when it has not — shown, not buried in logs */
        payoutNote: p.payoutState === 'PROCESSED' ? null : (p.lastTransferError ?? null),
        settledAt: p.transferredAt ?? null,
        createdAt: p.get('createdAt'),
        // the route this load actually rode
        from: shipment?.pickup?.name ?? null,
        to: trip?.destination?.name ?? null,
        cropType: shipment?.cropType ?? null,
        quantityKg: shipment?.quantityKg ?? null,
      };
    });

    const settled = payouts.filter((p) => p.payoutState === 'PROCESSED');
    const pending = payouts.filter((p) => p.payoutState === 'PENDING' || p.payoutState === 'CREATED');
    const failed = payouts.filter((p) => p.payoutState === 'FAILED');

    ok(res, {
      payouts,
      /** money that has actually reached the driver's account */
      total: settled.reduce((sum, p) => sum + p.amount, 0),
      /** earned and captured, but not yet transferred */
      pendingTotal: pending.reduce((sum, p) => sum + p.amount, 0),
      failedCount: failed.length,
      account,
      eligibility: payoutEligibility(account),
    });
  }),
);

// ---- webhook: the source of truth (ADR-012) ----

export const webhookRouter = Router();

/**
 * No JWT. Authenticated by verifying the signature over the RAW body, which is why
 * this router mounts its own raw parser before the app's JSON parser.
 *
 * IDEMPOTENT BY CONSTRUCTION (ADR-043). Razorpay retries a webhook until it gets a
 * 2xx, so the same event genuinely arrives more than once. Every delivery is first
 * claimed by inserting its `x-razorpay-event-id` into a uniquely-indexed
 * collection: the insert either succeeds (first time — process it) or throws
 * E11000 (a replay — acknowledge and drop). A check-then-act would race against a
 * concurrent redelivery; a unique insert cannot, which is what actually stops a
 * transporter being paid twice.
 *
 * Route event names are the documented ones: `transfer.processed`,
 * `transfer.failed` and `settlement.processed`, with the transfer entity at
 * `payload.transfer.entity` (razorpay.com/docs/webhooks/route).
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
        payment?: {
          entity: { id: string; order_id: string; fee?: number; tax?: number };
        };
        transfer?: {
          entity: {
            id: string;
            status: string;
            source?: string;
            recipient?: string;
            amount?: number;
            fees?: number;
            tax?: number;
            error?: { description?: string } | null;
          };
        };
        refund?: { entity: { id: string; payment_id: string; amount: number } };
      };
    };

    /*
     * Claim this delivery. Razorpay sends a stable `x-razorpay-event-id` per event
     * across all its retries; without the header we fall back to a fingerprint of
     * the entity ids so a replay is still caught.
     */
    const headerId = req.headers['x-razorpay-event-id'];
    const eventId =
      (typeof headerId === 'string' && headerId) ||
      `${event.event}:${event.payload.transfer?.entity.id ?? ''}${
        event.payload.refund?.entity.id ?? ''
      }${event.payload.payment?.entity.id ?? ''}`;

    try {
      await WebhookEvent.create({ eventId, event: event.event });
    } catch {
      // duplicate key — this exact event has already been acted on. Acknowledge,
      // so Razorpay stops retrying, and do nothing else.
      ok(res, { received: true, duplicate: true });
      return;
    }

    const orderId = event.payload.payment?.entity.order_id;

    switch (event.event) {
      case 'payment.captured': {
        const entity = event.payload.payment?.entity;
        const payment = orderId ? await Payment.findOne({ razorpayOrderId: orderId }) : null;
        if (payment && entity) {
          payment.razorpayPaymentId = entity.id;
          await payment.save();
          // Razorpay's own gateway fee, recorded only because Razorpay reported it
          await markCaptured(String(payment._id), { feePaise: entity.fee, taxPaise: entity.tax });
        }
        break;
      }

      case 'payment.failed': {
        const payment = orderId ? await Payment.findOne({ razorpayOrderId: orderId }) : null;
        if (payment) await markFailed(String(payment._id));
        break;
      }

      case 'transfer.processed':
      case 'transfer.failed': {
        const entity = event.payload.transfer?.entity;
        if (!entity) break;

        const known = await Payment.findOne({ transferId: entity.id });
        if (known) {
          await reconcileTransfer({
            transferId: entity.id,
            status: entity.status ?? (event.event === 'transfer.processed' ? 'processed' : 'failed'),
            feePaise: entity.fees,
            taxPaise: entity.tax,
            error: entity.error?.description,
          });
        } else if (entity.source?.startsWith('pay_')) {
          /*
           * A transfer Razorpay created itself from the order's `transfers[]`.
           * We have never seen its id before — the event's `source` payment is
           * what links it back to our row.
           */
          await attachOrderTransfer({
            razorpayPaymentId: entity.source,
            transferId: entity.id,
            status: entity.status ?? (event.event === 'transfer.processed' ? 'processed' : 'failed'),
            amountPaise: entity.amount,
            feePaise: entity.fees,
            taxPaise: entity.tax,
          });
        }
        break;
      }

      case 'settlement.processed':
        // the platform's own balance settling to its bank. Razorpay's normal
        // settlement cycle handles this; there is nothing for us to move.
        break;

      case 'refund.processed':
      case 'refund.created': {
        const entity = event.payload.refund?.entity;
        if (entity) {
          await reconcileRefund({
            razorpayPaymentId: entity.payment_id,
            refundId: entity.id,
            amountPaise: entity.amount,
          });
        }
        break;
      }

      default:
        break;
    }

    ok(res, { received: true });
  }),
);

export { payoutForPayment };
