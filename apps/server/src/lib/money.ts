/**
 * The one runtime source of the platform's commission (ADR-043).
 *
 * THE BUG THIS FILE EXISTS TO FIX
 * ------------------------------
 * There were two: `PLATFORM_COMMISSION_PCT = 0.1`, a literal in
 * `packages/shared/src/pooling.ts` that every pricing module actually used, and
 * `config.platformFeePct` (env `PLATFORM_FEE_PCT`), which was read from the
 * environment and then never referenced by anything. Setting `PLATFORM_FEE_PCT=15`
 * changed nothing at all, silently — the trip economics, the machinery quote, the
 * backhaul price and the Payment row would all still have used 10%.
 *
 * Now every one of them calls `commissionRate()`. `PLATFORM_FEE_PCT` is the single
 * knob, the shared constant is only its documented default, and a percentage
 * change is one environment variable rather than four literals (ADR-013).
 *
 * Nothing here changes how a trip's cost is split BETWEEN farmers — that is the
 * pooling engine's job and it is untouched (ADR-035).
 */
import { DEFAULT_PLATFORM_FEE_PCT, splitPaise, rupeesToPaise, type PaymentSplit } from '@kisanpool/shared';
import { config } from '../config';

/** The commission as a percentage (e.g. 10), from `PLATFORM_FEE_PCT`. */
export function commissionPct(): number {
  const pct = config.platformFeePct;
  // a nonsense env value must not silently zero the platform's revenue or
  // swallow the transporter's entire fare
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return DEFAULT_PLATFORM_FEE_PCT;
  return pct;
}

/** The same number as a rate (e.g. 0.1) — what the pricing modules multiply by. */
export const commissionRate = (): number => commissionPct() / 100;

/**
 * Split an already-final farmer amount in rupees into integer paise.
 *
 * The amount MUST come from the pricing engine (`shipment.finalPrice ?? allocatedPrice`),
 * never from a client. This function does not decide what anyone owes; it only
 * divides a decided number, exactly.
 */
export function platformSplit(amountRupees: number): PaymentSplit {
  return splitPaise(rupeesToPaise(amountRupees), commissionPct());
}

export { splitPaise, rupeesToPaise };
export { paiseToRupees } from '@kisanpool/shared';
