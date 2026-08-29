/**
 * Predictive Insights — advisory risk scoring, not machine learning (ADR-041).
 *
 * WHAT THIS IS
 * -----------
 * A deterministic, explainable scoring layer over signals the application already
 * records: route length, trip progress, ETA drift, pickup counts, a transporter's
 * own cancellation history, recent request volume on a corridor. Every score
 * arrives with the `reasons` that produced it and the raw `signals` behind those
 * reasons, so a farmer, a driver or an operator can check the call against what
 * they can see.
 *
 * WHAT THIS IS NOT
 * ---------------
 * It is not a model, it invents nothing, and it never acts. A prediction is shown,
 * never enforced: it cannot cancel a trip, move a price, reroute a vehicle, reject
 * a transporter or block a farmer. The deterministic backend stays authoritative
 * (`docs/API_CONTRACTS.md` §9). The scoring lives behind `assess*` service
 * functions so a trained model can replace the arithmetic later without any screen
 * or route changing.
 */

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DEMAND_LEVELS = ['NORMAL', 'MEDIUM', 'HIGH'] as const;
export type DemandLevel = (typeof DEMAND_LEVELS)[number];

/** What kind of operational risk a `RiskAssessment` is about. */
export type PredictionKind = 'DELIVERY_DELAY' | 'CANCELLATION';

/**
 * One risk call.
 *
 * `score` is 0–100 and monotonic with the level (thresholds below), kept only so
 * screens can sort or show a bar. The `reasons` are the product — never show a
 * level without at least one. `confidence` is LOW when the signals were too thin
 * to be sure, which the UI must surface rather than hide.
 */
export interface RiskAssessment {
  kind: PredictionKind;
  level: RiskLevel;
  score: number;
  /** plain-language, each tied to a real signal — safe to show verbatim */
  reasons: string[];
  /** the raw numbers behind the reasons, for an operator or a support agent */
  signals: Record<string, number | string | boolean>;
  /** LOW when the inputs were too sparse to trust the level */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** ISO — when this was computed, so a stale card can be labelled */
  computedAt: string;
}

/** Demand on one mandi / corridor. Same shape of evidence as a RiskAssessment. */
export interface DemandAssessment {
  mandi: string;
  level: DemandLevel;
  score: number;
  reasons: string[];
  signals: Record<string, number | string | boolean>;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  computedAt: string;
}

/** `GET /predictions/trips/:id` — for the farmers and driver on one trip. */
export interface TripPredictionDTO {
  tripId: string;
  tripState: string;
  delay: RiskAssessment;
  /** only present for the transporter / admin — a farmer is not shown this */
  cancellation?: RiskAssessment;
}

/** `GET /predictions/ops` — the admin roll-up across every live trip and corridor. */
export interface OpsPredictionDTO {
  generatedAt: string;
  trips: Array<{
    tripId: string;
    to: string;
    transporter: string;
    poolSize: number;
    delay: RiskAssessment;
    cancellation: RiskAssessment;
  }>;
  demand: DemandAssessment[];
}

/**
 * `trip:prediction` socket event — pushed when a trip's delay level CHANGES, not
 * on every GPS ping (ADR-041). Screens already holding a trip room get it for free.
 */
export interface TripPredictionEvent {
  tripId: string;
  delay: RiskAssessment;
}

// ---------------------------------------------------------------------------
// thresholds — the single place a score becomes a level, shared by every scorer
// ---------------------------------------------------------------------------

export const RISK_THRESHOLDS = { medium: 40, high: 70 } as const;
export const DEMAND_THRESHOLDS = { medium: 40, high: 70 } as const;

export const riskLevelFor = (score: number): RiskLevel =>
  score >= RISK_THRESHOLDS.high ? 'HIGH' : score >= RISK_THRESHOLDS.medium ? 'MEDIUM' : 'LOW';

export const demandLevelFor = (score: number): DemandLevel =>
  score >= DEMAND_THRESHOLDS.high ? 'HIGH' : score >= DEMAND_THRESHOLDS.medium ? 'MEDIUM' : 'NORMAL';
