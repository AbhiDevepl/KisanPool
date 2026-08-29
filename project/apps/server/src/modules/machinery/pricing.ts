import {
  AREA_BASED_UNITS,
  PLATFORM_COMMISSION_PCT,
  type MachineQuoteDTO,
  type PricingUnit,
} from '@kisanpool/shared';
import { money, type Point } from '../../lib/geo';
import { getDirections } from '../maps/service';

/**
 * Machinery pricing — the one place a hire's rupees are decided (ADR-038).
 *
 * Same discipline as the transport engine: no screen computes a price, the
 * breakdown travels with the number, and the quote a farmer accepts is stored so
 * the bill can be explained months later.
 *
 * The model is deliberately much simpler than pooled transport, because the
 * business is simpler. A hire is one provider and one farmer — there is nobody to
 * split a cost with, so there is no allocation problem to solve. What there IS is
 * a unit problem: the same platform has to quote a harvester by the acre, a
 * tractor by the hour and a water tanker by the job, and those are real-world
 * conventions, not preferences.
 *
 *     total = max( rate × billableUnits + travel , minimumCharge )
 *
 * Three parts, each one the provider's own number:
 *
 *   WORK      `rate × billableUnits`, where billableUnits is whatever the chosen
 *             unit counts — hours in the window, acres of field, days, or 1.
 *   TRAVEL    the machine has to reach the field and get home again, so the
 *             provider's per-km rate is charged over twice the one-way distance.
 *             A provider who does not charge for travel sets it to 0 and this
 *             term vanishes.
 *   MINIMUM   a provider will not move a combine for twenty minutes' work. The
 *             minimum charge tops the bill up rather than replacing it, so the
 *             farmer can see exactly what the shortfall was.
 *
 * Nothing here is a platform-invented multiplier. The only number KisanPool
 * contributes is its commission, which is the same PLATFORM_COMMISSION_PCT the
 * transport side uses — one platform, one cut.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Minimum billed hours — nobody sends a tractor out for six minutes. */
const MIN_BILLABLE_HOURS = 1;

export interface QuoteInput {
  unit: PricingUnit;
  rate: number;
  minimumCharge: number;
  travelRatePerKm: number;
  window: { start: Date; end: Date };
  /** required for area-priced units; the service validates this before we get here */
  areaAcres?: number | null;
  /** the machine's home, and the field it is going to */
  base: Point;
  site: Point;
}

/**
 * How many units this booking bills.
 *
 * Rounding is deliberately generous to the provider on time-based units and exact
 * on area — an hour started is an hour a machine could not be elsewhere, whereas
 * an acre is an acre.
 */
export function billableUnitsFor(input: {
  unit: PricingUnit;
  window: { start: Date; end: Date };
  areaAcres?: number | null;
}): number {
  const ms = Math.max(0, input.window.end.getTime() - input.window.start.getTime());

  switch (input.unit) {
    case 'PER_HOUR':
      return Math.max(MIN_BILLABLE_HOURS, Math.ceil(ms / HOUR_MS));
    case 'PER_DAY':
      return Math.max(1, Math.ceil(ms / DAY_MS));
    case 'PER_ACRE':
      return Math.max(0, Math.round((input.areaAcres ?? 0) * 100) / 100);
    case 'PER_JOB':
      return 1;
  }
}

/** True when this unit cannot be priced without the farmer stating an area. */
export const needsArea = (unit: PricingUnit): boolean => AREA_BASED_UNITS.includes(unit);

/**
 * Quote a hire. Pure with respect to the database, so the discovery list, the
 * booking sheet and the committed booking all run the identical computation and
 * cannot disagree.
 */
export async function quoteBooking(input: QuoteInput): Promise<MachineQuoteDTO> {
  const billableUnits = billableUnitsFor(input);
  const workCost = money(input.rate * billableUnits);

  const { distanceKm } = await getDirections(input.base, input.site);
  const travelKm = Math.round(distanceKm * 10) / 10;
  // out and back — the machine does not stay in the field
  const travelCost = money(travelKm * 2 * input.travelRatePerKm);

  const subtotal = money(workCost + travelCost);
  const minimumTopUp = Math.max(0, money(input.minimumCharge - subtotal));
  const total = money(subtotal + minimumTopUp);

  return {
    unit: input.unit,
    rate: input.rate,
    billableUnits,
    workCost,
    travelKm,
    travelCost,
    minimumTopUp,
    total,
    platformFee: money(total * PLATFORM_COMMISSION_PCT),
    providerEarning: money(total * (1 - PLATFORM_COMMISSION_PCT)),
  };
}

/**
 * Re-quote at completion, when the work took a different amount of time.
 *
 * Only time-based units can move: an acre is an acre however long it took, and a
 * per-job price was agreed as a job. This is what makes `finalAmount` honest
 * rather than a copy of the estimate.
 */
export async function requoteOnCompletion(
  original: QuoteInput,
  actual: { start: Date; end: Date },
): Promise<MachineQuoteDTO> {
  if (original.unit === 'PER_ACRE' || original.unit === 'PER_JOB') {
    return quoteBooking(original);
  }
  return quoteBooking({ ...original, window: actual });
}
