/**
 * The scoring itself — pure, deterministic, no database, no clock of its own
 * (every function takes `now`/`computedAt`), so it is unit-testable and a rerun on
 * the same signals gives the same call every time (ADR-041).
 *
 * Each scorer accumulates points against named reasons. A reason is only added
 * when its signal actually fired, so the `reasons` array is a faithful list of
 * why the level is what it is — never decoration.
 */
import {
  type DemandAssessment,
  type RiskAssessment,
  demandLevelFor,
  riskLevelFor,
} from '@kisanpool/shared';

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** rough road speed used only to turn a distance into an expected duration */
const AVG_SPEED_KMH = 35;
/** minutes a driver typically spends at each pickup */
const DWELL_MIN_PER_PICKUP = 12;

/** Plan minutes for a whole collection run: driving + a dwell at each stop. */
export function plannedTripMinutes(routeKm: number, pickupCount: number): number {
  return Math.round((routeKm / AVG_SPEED_KMH) * 60 + Math.max(0, pickupCount) * DWELL_MIN_PER_PICKUP);
}

// ---------------------------------------------------------------------------
// A. possible delivery delay
// ---------------------------------------------------------------------------

export interface DelaySignals {
  tripState: string;
  routeKm: number;
  pickupCount: number;
  /** pickups collected (PICKED_UP or later) */
  pickupsDone: number;
  /** shipments delivered at the mandi */
  delivered: number;
  /** since trip.startedAt; 0 or negative means "not started" */
  minutesSinceStart: number;
  /** last ETA the vehicle reported to its next stop, if any */
  etaMinutes: number | null;
  /** minutes since the last GPS ping; null if it has never reported */
  minutesSinceLastPing: number | null;
  /** minutes the current lead shipment has sat in its present state */
  leadShipmentStuckMinutes: number;
  /** a pickup whose reported ETA has already elapsed without an ARRIVED */
  pickupOverdueMinutes: number;
}

export function scoreDelayRisk(signals: DelaySignals, computedAt: string): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  const planned = plannedTripMinutes(signals.routeKm, signals.pickupCount);
  const totalStops = Math.max(1, signals.pickupCount + 1); // pickups + the mandi
  const progress = clamp((signals.pickupsDone + signals.delivered) / totalStops, 0, 1);
  const active = ['EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'].includes(signals.tripState);
  const started = signals.minutesSinceStart > 0;

  // behind schedule: where the run should be by now vs where it is
  let expectedProgress = 0;
  if (started && planned > 0) {
    expectedProgress = clamp(signals.minutesSinceStart / planned, 0, 1);
    const gap = expectedProgress - progress;
    if (gap > 0.15) {
      score += gap > 0.35 ? 40 : 25;
      reasons.push(
        `Progress is behind schedule — about ${Math.round(progress * 100)}% done, ` +
          `roughly ${Math.round(expectedProgress * 100)}% expected by now.`,
      );
    }
    if (signals.minutesSinceStart > planned * 1.2 && progress < 1) {
      score += 20;
      reasons.push(
        `The run has taken ${signals.minutesSinceStart} min against a ~${planned} min plan and is not finished.`,
      );
    }
  }

  if (signals.routeKm > 350) {
    score += 20;
    reasons.push(`Long route — ${round1(signals.routeKm)} km to the mandi leaves little slack.`);
  } else if (signals.routeKm > 200) {
    score += 10;
    reasons.push(`Route is ${round1(signals.routeKm)} km — a longer haul than average.`);
  }

  if (signals.pickupCount >= 4) {
    score += 20;
    reasons.push(`${signals.pickupCount} pickups on one run — each stop adds delay risk.`);
  } else if (signals.pickupCount === 3) {
    score += 10;
    reasons.push(`Three pickups before the mandi.`);
  }

  if (active && signals.minutesSinceLastPing != null && signals.minutesSinceLastPing > 20) {
    score += 20;
    reasons.push(
      `No location update for ${signals.minutesSinceLastPing} min while the trip is moving.`,
    );
  }

  if (signals.leadShipmentStuckMinutes > 90) {
    score += 35;
    reasons.push(`The current stop has not changed for ${signals.leadShipmentStuckMinutes} min.`);
  } else if (signals.leadShipmentStuckMinutes > 45) {
    score += 20;
    reasons.push(`The current stop has been ${signals.leadShipmentStuckMinutes} min without progress.`);
  }

  if (signals.pickupOverdueMinutes > 30) {
    score += 25;
    reasons.push(`A pickup is ${signals.pickupOverdueMinutes} min past its expected arrival.`);
  }

  if (
    signals.etaMinutes != null &&
    started &&
    signals.minutesSinceStart + signals.etaMinutes > planned + 45
  ) {
    score += 15;
    reasons.push(
      `Current ETA puts arrival ~${Math.round(
        signals.minutesSinceStart + signals.etaMinutes - planned,
      )} min beyond the plan.`,
    );
  }

  // confidence: how much of the picture we actually had
  let confidence: RiskAssessment['confidence'] = 'HIGH';
  if (!started) confidence = 'LOW';
  else if (signals.minutesSinceLastPing == null) confidence = 'MEDIUM';

  score = clamp(score);
  const level = confidence === 'LOW' ? 'LOW' : riskLevelFor(score);

  if (!reasons.length) {
    reasons.push(
      started
        ? 'On track — progress matches the expected schedule and the vehicle is reporting in.'
        : 'The trip has not started yet — a delay call needs it to be en route.',
    );
  }

  return {
    kind: 'DELIVERY_DELAY',
    level,
    score,
    reasons,
    confidence,
    computedAt,
    signals: {
      tripState: signals.tripState,
      routeKm: round1(signals.routeKm),
      pickupCount: signals.pickupCount,
      progressPct: Math.round(progress * 100),
      expectedProgressPct: Math.round(expectedProgress * 100),
      plannedMinutes: planned,
      minutesSinceStart: Math.max(0, signals.minutesSinceStart),
      minutesSinceLastPing: signals.minutesSinceLastPing ?? -1,
      leadShipmentStuckMinutes: signals.leadShipmentStuckMinutes,
      pickupOverdueMinutes: signals.pickupOverdueMinutes,
    },
  };
}

// ---------------------------------------------------------------------------
// B. vehicle / trip cancellation risk
// ---------------------------------------------------------------------------

export interface CancellationSignals {
  tripState: string;
  /** the transporter's own record */
  completedTrips: number;
  cancelledTrips: number;
  offersMade: number;
  offersWithdrawn: number;
  /** trip still FORMING this long after the first farmer confirmed */
  minutesSinceFirstConfirm: number;
  vehicleOffline: boolean;
  /** minutes of GPS silence during an active trip; null if never reported */
  minutesSinceLastPing: number | null;
  /** a pickup whose ETA elapsed without an ARRIVED */
  pickupOverdueMinutes: number;
}

export function scoreCancellationRisk(
  signals: CancellationSignals,
  computedAt: string,
): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  const history = signals.completedTrips + signals.cancelledTrips;
  const cancelRate = history > 0 ? signals.cancelledTrips / history : 0;
  const withdrawRate = signals.offersMade > 0 ? signals.offersWithdrawn / signals.offersMade : 0;
  const thinHistory = history < 3;

  if (!thinHistory && cancelRate > 0.3) {
    score += 40;
    reasons.push(
      `This transporter has cancelled ${signals.cancelledTrips} of ${history} past trips ` +
        `(${Math.round(cancelRate * 100)}%).`,
    );
  } else if (!thinHistory && cancelRate > 0.15) {
    score += 20;
    reasons.push(
      `Above-average cancellation history — ${Math.round(cancelRate * 100)}% of past trips.`,
    );
  }

  if (signals.offersMade >= 4 && withdrawRate > 0.3) {
    score += 20;
    reasons.push(
      `Withdraws claims often — ${signals.offersWithdrawn} of ${signals.offersMade} offers pulled back.`,
    );
  }

  if (signals.tripState === 'FORMING' && signals.minutesSinceFirstConfirm > 360) {
    score += 40;
    reasons.push(
      `A farmer confirmed ${Math.round(signals.minutesSinceFirstConfirm / 60)} h ago and the trip still has not started.`,
    );
  } else if (signals.tripState === 'FORMING' && signals.minutesSinceFirstConfirm > 120) {
    score += 22;
    reasons.push(
      `${signals.minutesSinceFirstConfirm} min since the first confirmation with no departure yet.`,
    );
  }

  if (signals.vehicleOffline && ['FORMING', 'EN_ROUTE', 'IN_TRANSIT'].includes(signals.tripState)) {
    score += 30;
    reasons.push('The vehicle has been marked offline while a trip is open on it.');
  }

  if (
    ['EN_ROUTE', 'IN_TRANSIT'].includes(signals.tripState) &&
    signals.minutesSinceLastPing != null &&
    signals.minutesSinceLastPing > 30
  ) {
    score += 20;
    reasons.push(`No contact from the vehicle for ${signals.minutesSinceLastPing} min.`);
  }

  if (signals.pickupOverdueMinutes > 45) {
    score += 20;
    reasons.push(`A pickup is ${signals.pickupOverdueMinutes} min overdue.`);
  }

  let confidence: RiskAssessment['confidence'] = 'HIGH';
  if (thinHistory) confidence = signals.completedTrips + signals.cancelledTrips === 0 ? 'LOW' : 'MEDIUM';

  score = clamp(score);
  // thin history can still flag on live signals (offline, overdue) but not on rate
  const level = riskLevelFor(score);

  if (!reasons.length) {
    reasons.push(
      thinHistory
        ? 'Not enough trip history for this transporter yet — no live warning signs either.'
        : 'Reliable history and no live warning signs.',
    );
  }

  return {
    kind: 'CANCELLATION',
    level,
    score,
    reasons,
    confidence,
    computedAt,
    signals: {
      tripState: signals.tripState,
      completedTrips: signals.completedTrips,
      cancelledTrips: signals.cancelledTrips,
      cancelRatePct: Math.round(cancelRate * 100),
      withdrawRatePct: Math.round(withdrawRate * 100),
      minutesSinceFirstConfirm: signals.minutesSinceFirstConfirm,
      vehicleOffline: signals.vehicleOffline,
      minutesSinceLastPing: signals.minutesSinceLastPing ?? -1,
      pickupOverdueMinutes: signals.pickupOverdueMinutes,
    },
  };
}

// ---------------------------------------------------------------------------
// C. high-demand route / mandi
// ---------------------------------------------------------------------------

export interface DemandSignals {
  mandi: string;
  /** requests created for this mandi in the recent window */
  recentRequests: number;
  windowDays: number;
  /** OPEN or TRANSPORTER_INTERESTED right now */
  openRequests: number;
  /** trips currently heading there */
  activeTrips: number;
  /** completed trips to this mandi — the established-corridor baseline */
  historicalTrips: number;
  distinctFarmers: number;
}

export function scoreDemand(signals: DemandSignals, computedAt: string): DemandAssessment {
  const reasons: string[] = [];
  let score = 0;

  if (signals.openRequests >= 5) {
    score += 45;
    reasons.push(`${signals.openRequests} requests are open to this mandi right now.`);
  } else if (signals.openRequests >= 3) {
    score += 30;
    reasons.push(`${signals.openRequests} open requests waiting for a transporter.`);
  } else if (signals.openRequests >= 1) {
    score += 12;
    reasons.push(`${signals.openRequests} open request${signals.openRequests === 1 ? '' : 's'} to this mandi.`);
  }

  if (signals.recentRequests >= 10) {
    score += 35;
    reasons.push(`${signals.recentRequests} requests in the last ${signals.windowDays} days.`);
  } else if (signals.recentRequests >= 5) {
    score += 20;
    reasons.push(`${signals.recentRequests} requests over the last ${signals.windowDays} days.`);
  }

  if (signals.openRequests > signals.activeTrips) {
    score += 18;
    reasons.push(
      `Only ${signals.activeTrips} trip${signals.activeTrips === 1 ? '' : 's'} heading there against ${signals.openRequests} open request${signals.openRequests === 1 ? '' : 's'} — a supply gap.`,
    );
  }

  if (signals.historicalTrips >= 5) {
    score += 8;
    reasons.push(`An established corridor — ${signals.historicalTrips} completed trips on record.`);
  }

  if (signals.distinctFarmers >= 3) {
    score += 6;
    reasons.push(`${signals.distinctFarmers} different farmers sending produce this way.`);
  }

  const thin = signals.recentRequests + signals.historicalTrips < 3 && signals.openRequests < 3;
  const confidence: DemandAssessment['confidence'] = thin
    ? 'LOW'
    : signals.recentRequests + signals.historicalTrips >= 8
      ? 'HIGH'
      : 'MEDIUM';

  score = clamp(score);
  const level = demandLevelFor(score);

  if (!reasons.length) {
    reasons.push('Quiet corridor — no open requests and little recent volume.');
  }

  return {
    mandi: signals.mandi,
    level,
    score,
    reasons,
    confidence,
    computedAt,
    signals: {
      openRequests: signals.openRequests,
      recentRequests: signals.recentRequests,
      windowDays: signals.windowDays,
      activeTrips: signals.activeTrips,
      historicalTrips: signals.historicalTrips,
      distinctFarmers: signals.distinctFarmers,
    },
  };
}
