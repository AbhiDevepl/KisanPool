/**
 * The money split, defined once (ADR-043).
 *
 * THE ONE RULE
 * ------------
 * The pooled pricing engine (ADR-035) decides what each farmer owes. This file
 * decides nothing about that. It only takes an already-final farmer amount and
 * splits it into the platform's commission and the transporter's share — and it
 * does so in INTEGER PAISE, because that is the unit Razorpay actually moves and
 * the only one where "the parts sum to the whole" is true without qualification.
 *
 * `splitPaise` is pure and lives in shared so there is exactly one definition of
 * the split in the repository. It is called by the SERVER ONLY. No screen splits
 * money; screens render what the server returned (docs/API_CONTRACTS.md §7).
 *
 *
 * WHY PAISE, AND WHY THE REMAINDER GOES TO THE TRANSPORTER
 * -------------------------------------------------------
 * ₹3,672.84 at 10% is ₹367.284 — a number that does not exist. Rounding both
 * sides independently either loses or invents a paisa, and over a pooled trip
 * with three farmers that is three chances to make the books not add up.
 *
 * So: round the platform's cut, then give the transporter the exact remainder.
 *
 *     platformFeePaise    = round(amountPaise × pct / 100)
 *     transporterPaise    = amountPaise − platformFeePaise
 *
 * By construction `platformFeePaise + transporterPaise === amountPaise`, always,
 * for every amount and every percentage. The sub-paisa remainder is deterministic
 * and always lands on the transporter, which is both reconcilable and the fair
 * direction to round in a marketplace that exists to pay small operators.
 *
 *
 * WHAT THIS SPLIT IS *NOT*
 * ------------------------
 * It is the COMMERCIAL split, not a settlement forecast. Razorpay charges a
 * payment-gateway fee on the whole captured amount and a transfer fee on each
 * Route transfer, both plus GST, and both are borne by the platform account
 * (razorpay.com/docs/payments/route/transfer-fees-example). So the transporter
 * receives `transporterPaise` gross, while what the platform actually keeps is
 * `platformFeePaise` minus those processing fees. Those fees are recorded only
 * when Razorpay reports them — never estimated here (ADR-043).
 */

/**
 * The platform's commission, as a percentage of the farmer's final amount.
 *
 * This is the DEFAULT only. The running value comes from `PLATFORM_FEE_PCT` in
 * the server's config, which is the single runtime source for every pricing
 * module (pooled transport, machinery, backhaul). Policy numbers are config,
 * never literals (ADR-013).
 */
export const DEFAULT_PLATFORM_FEE_PCT = 10;

/** Razorpay refuses a Route transfer below ₹1.00 (100 paise). */
export const MIN_TRANSFER_PAISE = 100;

export interface PaymentSplit {
  /** what the farmer is charged, in paise — the authoritative pricing result */
  amountPaise: number;
  /** the platform's commission before Razorpay's own processing fees */
  platformFeePaise: number;
  /** what is transferred to the transporter's linked account, gross */
  transporterPaise: number;
  /** the percentage this split was computed with, stored so a bill is explainable */
  feePct: number;
}

/**
 * Split a final farmer amount into commission and transporter share.
 *
 * Pure, deterministic, and exact: the two parts always sum to `amountPaise`.
 * Negative or non-finite input is clamped to zero rather than propagating a NaN
 * into a payment record.
 */
export function splitPaise(amountPaise: number, feePct: number): PaymentSplit {
  const amount = Number.isFinite(amountPaise) ? Math.max(0, Math.round(amountPaise)) : 0;
  const pct = Number.isFinite(feePct) ? Math.min(100, Math.max(0, feePct)) : 0;

  const platformFeePaise = Math.round((amount * pct) / 100);
  // the remainder, not a second rounding — this is what makes the sum exact
  const transporterPaise = amount - platformFeePaise;

  return { amountPaise: amount, platformFeePaise, transporterPaise, feePct: pct };
}

/** ₹ → paise. Money crosses the Razorpay boundary in integers only. */
export const rupeesToPaise = (rupees: number): number =>
  Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;

/** paise → ₹, for display and for the rupee-denominated legacy fields. */
export const paiseToRupees = (paise: number): number =>
  Number.isFinite(paise) ? Math.round(paise) / 100 : 0;

// ---------------------------------------------------------------------------
// the payout's own lifecycle — separate from the farmer's payment (ADR-043)
// ---------------------------------------------------------------------------

/**
 * A payment being PAID says the farmer's money arrived. It says nothing about
 * whether the transporter has been paid, which is a different fact with its own
 * failure modes — so it gets its own field rather than being inferred from the
 * presence of a transfer id.
 */
export const PAYOUT_STATES = [
  /** captured, but no transfer attempted yet (or the account was not eligible) */
  'PENDING',
  /** Razorpay has the transfer and it is awaiting capture/settlement */
  'CREATED',
  /** transfer.processed — the money reached the linked account */
  'PROCESSED',
  /** transfer.failed — retryable, and NOT the farmer's problem */
  'FAILED',
  /** reversed back to the platform, usually to fund a refund */
  'REVERSED',
  /** nothing to pay out (fully refunded before any transfer) */
  'NOT_APPLICABLE',
] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

/** Payout states from which a retry is safe — anything else would double-pay. */
export const RETRYABLE_PAYOUT_STATES: PayoutState[] = ['PENDING', 'FAILED'];

/**
 * How Razorpay was asked to move the transporter's share.
 *
 * ORDER  — `transfers[]` on the Orders API: Razorpay creates and settles the
 *          transfer itself once the payment is captured. Preferred, because
 *          there is no window in which we are holding money we owe someone.
 * PAYMENT— `POST /payments/:id/transfers` after capture. The fallback for when
 *          the linked account was not usable at order time.
 * NONE   — no transfer configured (demo mode, or no eligible linked account).
 */
export const TRANSFER_MODES = ['ORDER', 'PAYMENT', 'NONE'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

/**
 * The full financial picture of one settled load, as the admin console reads it.
 *
 * Deliberately distinguishes the four different things people call "the fee":
 * what the farmer paid, what KisanPool charges, what the transporter gets, and
 * what Razorpay took. Only the first three are ours to decide.
 */
export interface SettlementDTO {
  amountPaise: number;
  platformFeePaise: number;
  transporterPaise: number;
  feePct: number;
  /** Razorpay's gateway fee + tax on the capture, when Razorpay has reported it */
  gatewayFeePaise: number | null;
  /** Razorpay's Route transfer fee + tax, when reported on the transfer */
  transferFeePaise: number | null;
  /** platformFeePaise − (gateway + transfer fees), null while any fee is unknown */
  netPlatformPaise: number | null;
  payoutState: PayoutState;
  transferMode: TransferMode;
  transferId: string | null;
  reversedPaise: number;
}
