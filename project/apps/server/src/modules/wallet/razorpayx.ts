/**
 * RazorpayX Payouts — send a transporter's wallet withdrawal to a UPI ID.
 *
 * The SDK does not cover X, so this is a thin HTTPS client using Basic auth with
 * the Razorpay key pair. Every payout carries an idempotency key so a retried
 * withdrawal request can never move money twice.
 *
 * With no key pair or no source account number configured, `enabled` is false and
 * the wallet service uses a deterministic demo payout instead (ADR-038).
 */
import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import { toPaise } from '../../lib/geo';

export const razorpayxEnabled = (): boolean => config.razorpayx.enabled;

const authHeader = (): string =>
  'Basic ' +
  Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');

async function xFetch<T>(pathname: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${config.razorpayx.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(idempotencyKey ? { 'X-Payout-Idempotency': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      ((json.error as { description?: string } | undefined)?.description) ??
      `RazorpayX responded ${res.status}`;
    throw new ApiError('PAYOUT_TRANSFER_FAILED', message, json);
  }
  return json as T;
}

/** RazorpayX payout `status` -> our WithdrawalStatus. */
export function mapPayoutStatus(status: string): 'PENDING' | 'SUCCESS' | 'FAILED' {
  const s = status.toLowerCase();
  if (s === 'processed') return 'SUCCESS';
  if (s === 'failed' || s === 'reversed' || s === 'cancelled' || s === 'rejected') return 'FAILED';
  return 'PENDING'; // queued | pending | processing | scheduled
}

export interface XPayoutResult {
  id: string;
  status: string;
}

/**
 * Contact -> VPA fund account -> payout, in one call. Returns the payout id and
 * its current RazorpayX status. Throws PAYOUT_TRANSFER_FAILED on any API error.
 */
export async function createUpiPayout(args: {
  name: string;
  upiId: string;
  amountRupees: number;
  referenceId: string;
  notes?: Record<string, string>;
}): Promise<XPayoutResult> {
  const contact = await xFetch<{ id: string }>('/contacts', {
    name: args.name || 'KisanPool Transporter',
    type: 'vendor',
    reference_id: `kp_contact_${args.referenceId}`,
  });

  const fundAccount = await xFetch<{ id: string }>('/fund_accounts', {
    contact_id: contact.id,
    account_type: 'vpa',
    vpa: { address: args.upiId },
  });

  const payout = await xFetch<XPayoutResult>(
    '/payouts',
    {
      account_number: config.razorpayx.accountNumber,
      fund_account_id: fundAccount.id,
      amount: toPaise(args.amountRupees),
      currency: 'INR',
      mode: 'UPI',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: args.referenceId,
      notes: args.notes,
    },
    args.referenceId,
  );

  return { id: payout.id, status: payout.status };
}
