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

// ---------------------------------------------------------------------------
// Razorpay Route (ADR-043)
//
// Verified against the official documentation rather than from memory:
//
//   Transfers via Orders   POST /v1/orders with a `transfers[]` array. Each entry
//                          takes { account, amount (PAISE), currency: 'INR',
//                          notes?, linked_account_notes?, on_hold?, on_hold_until? }.
//                          The transfer is created with the order and stays in
//                          `created` until the payment is CAPTURED, after which
//                          Razorpay moves it on by itself. The sum of transfers
//                          may not exceed the order amount; whatever is not
//                          transferred stays with the platform. Minimum transfer
//                          is 100 paise. INR only.
//                          razorpay.com/docs/api/payments/route/create-transfers-orders
//
//   Transfers via Payments POST /v1/payments/:id/transfers, only once the payment
//                          is captured. Our fallback when the linked account was
//                          not usable at order time.
//                          razorpay.com/docs/api/payments/route/create-transfers-payments
//
//   Linked accounts        Created through the Route onboarding APIs, NOT the
//                          Customers API. A new linked account has a documented
//                          24-HOUR COOLING PERIOD before it may receive a
//                          transfer. razorpay.com/docs/payments/route/linked-account
//
//   Fees                   A gateway fee on the whole captured amount and a Route
//                          transfer fee on each transfer, both plus GST, both
//                          borne by the PLATFORM account. The linked account
//                          receives its transfer gross.
//                          razorpay.com/docs/payments/route/transfer-fees-example
// ---------------------------------------------------------------------------

/** Razorpay refuses a transfer below ₹1.00. */
const MIN_TRANSFER_PAISE = 100;

/**
 * Does this look like a real Route linked account id?
 *
 * Razorpay's ids are `acc_` plus a 14-character key — exactly 18 characters, and
 * the API rejects anything else with "The account must be 18 characters",
 * failing the WHOLE order. Seeded and demo accounts use readable placeholders
 * like `acc_demo_<userId>`, so without this guard a demo payout account would
 * take the farmer's real payment down with it (ADR-043).
 */
export function isRouteAccountId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^acc_[A-Za-z0-9]{14}$/.test(id);
}

export interface RouteTransferRequest {
  /** the linked account id, `acc_…` */
  account: string;
  /** integer paise */
  amount: number;
  notes?: Record<string, string>;
}

/** The `transfers[]` entry the Orders API expects. Returns null when ineligible. */
export function orderTransfer(req: RouteTransferRequest): Record<string, unknown> | null {
  if (!isRouteAccountId(req.account) || !Number.isInteger(req.amount) || req.amount < MIN_TRANSFER_PAISE) {
    return null;
  }
  return {
    account: req.account,
    amount: req.amount,
    currency: 'INR',
    notes: req.notes ?? {},
    // the driver should be able to see which load a credit was for
    linked_account_notes: req.notes ? Object.keys(req.notes).slice(0, 1) : [],
    // KisanPool bills only after delivery, so there is nothing left to hold for
    on_hold: false,
  };
}

export interface RouteTransferResult {
  id: string;
  status: string;
  /** Razorpay's transfer fee, in paise — present only once Razorpay reports it */
  fees?: number;
  tax?: number;
}

/** `POST /v1/payments/:id/transfers` — the post-capture fallback path. */
export async function transferOnPayment(
  razorpayPaymentId: string,
  req: RouteTransferRequest,
): Promise<RouteTransferResult> {
  if (!razorpay) throw new Error('razorpay not configured');

  const client = razorpay as unknown as {
    payments: {
      transfer: (id: string, body: unknown) => Promise<{ items?: RouteTransferResult[] } & RouteTransferResult>;
    };
  };

  const response = await client.payments.transfer(razorpayPaymentId, {
    transfers: [
      { account: req.account, amount: req.amount, currency: 'INR', notes: req.notes ?? {} },
    ],
  });

  // the API answers with a collection; a single-transfer request has one item
  const first = response.items?.[0] ?? (response as RouteTransferResult);
  if (!first?.id) throw new Error('transfer response carried no id');
  return first;
}

/**
 * `POST /v1/transfers/:id/reversals` — claw a processed transfer back to the
 * platform so a refund can be funded. Amount in paise; omit for a full reversal.
 */
export async function reverseTransfer(
  transferId: string,
  amountPaise?: number,
): Promise<{ id: string; amount?: number }> {
  if (!razorpay) throw new Error('razorpay not configured');
  const client = razorpay as unknown as {
    transfers: { reverse: (id: string, body?: unknown) => Promise<{ id: string; amount?: number }> };
  };
  return client.transfers.reverse(
    transferId,
    amountPaise != null ? { amount: amountPaise } : {},
  );
}

/**
 * Create a Route linked account for a transporter.
 *
 * Uses the Route onboarding API. The previous implementation called
 * `customers.create`, which creates a CUSTOMER — an entity that can never
 * receive a transfer — so every payout against it would have failed at the
 * first real transfer attempt (ADR-043).
 *
 * Returns PENDING, never ACTIVE: a new linked account has a documented 24-hour
 * cooling period and Razorpay must still verify the bank account, so claiming it
 * is payable immediately would be a lie the first transfer would expose.
 */
export async function createLinkedAccount(args: {
  name: string;
  email: string;
  phone: string;
  referenceId: string;
}): Promise<{ accountId: string }> {
  if (!razorpay) throw new Error('razorpay not configured');

  const client = razorpay as unknown as {
    accounts: { create: (body: unknown) => Promise<{ id: string }> };
  };

  const account = await client.accounts.create({
    email: args.email,
    phone: args.phone,
    type: 'route',
    reference_id: args.referenceId,
    legal_business_name: args.name,
    business_type: 'individual',
    profile: {
      category: 'transport',
      subcategory: 'freight',
    },
  });

  return { accountId: account.id };
}

export { MIN_TRANSFER_PAISE };
