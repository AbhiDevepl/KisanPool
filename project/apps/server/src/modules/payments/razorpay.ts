import crypto from 'crypto';
import Razorpay from 'razorpay';
import { config } from '../../config';

export const razorpay = config.razorpay.enabled
  ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret })
  : null;

/**
 * Server-side signature verification — never trust the client callback alone
 * (docs/ARCHITECTURE.md §5, ADR-012).
 */
export function verifyCheckoutSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest('hex');
  return timingSafeEqual(expected, args.signature);
}

/** HMAC of the RAW body — the route must be mounted before any JSON parser. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b ?? '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
