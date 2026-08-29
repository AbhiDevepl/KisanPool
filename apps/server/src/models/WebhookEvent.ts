import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One Razorpay webhook delivery, recorded so it is only ever acted on once
 * (ADR-043).
 *
 * Razorpay retries a webhook until it gets a 2xx, so the SAME event genuinely
 * does arrive more than once — that is documented behaviour, not an edge case.
 * Without this, a redelivered `transfer.processed` is harmless but a redelivered
 * `payment.captured` would re-enter the payout path, and the guard against
 * paying a transporter twice would be nothing but the ordering of two awaits.
 *
 * The unique index on `eventId` IS the idempotency mechanism: the insert either
 * succeeds (first delivery — process it) or throws E11000 (a replay — drop it).
 * A check-then-act would race against a concurrent redelivery; an insert cannot.
 *
 * This is not a ledger. It stores no money, only the fact that an event was seen.
 */
const webhookEventSchema = new Schema(
  {
    /** Razorpay's `x-razorpay-event-id` header — unique per event, stable across retries */
    eventId: { type: String, required: true, unique: true },
    event: { type: String, required: true },
    /** what it resolved to, so a support question does not need the raw payload */
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: undefined, index: true },
    processedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// deliveries are only interesting for a few weeks; keep the collection bounded
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type WebhookEventAttrs = InferSchemaType<typeof webhookEventSchema>;
export type WebhookEventDoc = HydratedDocument<WebhookEventAttrs>;
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
