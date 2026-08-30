/**
 * The resilience contract — recovery states, journal events, integrity findings
 * (ADR-044).
 *
 * THE TWO INCIDENTS, WHICH ARE NOT THE SAME THING
 * -----------------------------------------------
 * Conflating them is the mistake this whole layer exists to avoid:
 *
 *   INFRASTRUCTURE FAILURE — a node dies, the primary steps down. The DATA is
 *   fine. Atlas elects a new primary in seconds and the driver retries. The right
 *   response is to WAIT, not to fail over to some other store. Replication is for
 *   availability.
 *
 *   DATA LOSS OR CORRUPTION — the data itself is gone, wrong, or unreadable.
 *   Replication faithfully replicates the damage to every member, so failover
 *   fixes nothing. The right response is a point-in-time restore from backup.
 *   PITR is for disaster recovery.
 *
 * A system that treats the second like the first waits forever. A system that
 * treats the first like the second restores a database that was never broken.
 *
 *
 * WHAT IS AUTHORITATIVE, AND WHAT IS NOT
 * --------------------------------------
 * MongoDB is the system of record. Always. The continuity layer never becomes
 * "the database for a while" — it holds two quite different things:
 *
 *   SNAPSHOTS  last-known-good READ state (trip status, last position, ETA,
 *              capacity). Safe to show while the database is away, clearly
 *              labelled as of a timestamp. Losing them costs nothing.
 *
 *   JOURNAL    durable, append-only INTENT for critical mutations. This is not a
 *              cache and must never be stored in one. It is what lets an operation
 *              that was in flight during an incident be replayed afterwards
 *              instead of vanishing.
 *
 * And the rule that governs the whole thing: **an operation is only ever reported
 * as done when MongoDB (or, for money, the payment provider) says it is done.**
 * A journalled intent is a promise to try, not a receipt.
 */

// ---------------------------------------------------------------------------
// dependency health
// ---------------------------------------------------------------------------

export const DEPENDENCY_STATES = ['UP', 'DEGRADED', 'DOWN', 'NOT_CONFIGURED'] as const;
export type DependencyState = (typeof DEPENDENCY_STATES)[number];

export interface DependencyHealth {
  state: DependencyState;
  /** round-trip of the last probe, ms — null when the probe did not complete */
  latencyMs: number | null;
  /** consecutive failed probes; the debounce that stops one blip declaring an incident */
  consecutiveFailures: number;
  detail: string;
  checkedAt: string;
}

/**
 * What the durable journal is actually backed by, and whether that backing is
 * genuinely durable.
 *
 * `REDIS_AOF` is only reported when Redis has confirmed `appendonly yes`. A Redis
 * running as a pure cache CAN lose writes on restart, so it is reported as
 * `REDIS_CACHE_ONLY` and is NOT used to hold pending intent — the file journal
 * takes over. Calling a cache durable is exactly the assumption that loses a
 * booking at 3am.
 */
export const JOURNAL_BACKENDS = [
  'FILE',
  'REDIS_AOF',
  'REDIS_CACHE_ONLY',
  'NONE',
] as const;
export type JournalBackend = (typeof JOURNAL_BACKENDS)[number];

export interface JournalHealth {
  backend: JournalBackend;
  durable: boolean;
  pending: number;
  failed: number;
  detail: string;
}

// ---------------------------------------------------------------------------
// the recovery state machine
// ---------------------------------------------------------------------------

/**
 * HEALTHY           everything nominal
 * DEGRADED          a dependency is unhappy but the database still answers —
 *                   e.g. Redis is gone, or Mongo is slow/failing intermittently
 * RECOVERY_REQUIRED an incident is confirmed: the database is unreachable past
 *                   the failure threshold, or an integrity check found damage
 * RESTORING         a point-in-time restore is in progress (operator-driven)
 * RECONCILING       the database is back; pending journal intent is being replayed
 * VALIDATING        integrity checks are running over the restored state
 * RECOVERED         validation passed; snapshots rebuilt; normal service resumed
 * MANUAL_REVIEW     recovery finished but something could not be resolved safely
 */
export const RECOVERY_STATES = [
  'HEALTHY',
  'DEGRADED',
  'RECOVERY_REQUIRED',
  'RESTORING',
  'RECONCILING',
  'VALIDATING',
  'RECOVERED',
  'MANUAL_REVIEW',
] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

/** States in which new irreversible business actions must not be accepted. */
export const RESTRICTED_STATES: RecoveryState[] = [
  'RECOVERY_REQUIRED',
  'RESTORING',
  'RECONCILING',
];

// ---------------------------------------------------------------------------
// the recovery journal
// ---------------------------------------------------------------------------

/** Critical mutations worth preserving across an incident. */
export const JOURNAL_EVENT_TYPES = [
  'REQUEST_CREATED',
  'OFFER_CLAIMED',
  'OFFER_WITHDRAWN',
  'TRANSPORTER_SELECTED',
  'SHIPMENT_ADDED',
  'SHIPMENT_STATE_CHANGED',
  'SHIPMENT_CANCELLED',
  'CAPACITY_CHANGED',
  'PRICING_RECALCULATED',
  'TRIP_STATE_CHANGED',
  'PAYMENT_STATE_CHANGED',
  'PAYOUT_STATE_CHANGED',
  'MACHINE_BOOKING_CREATED',
  'MACHINE_BOOKING_STATE_CHANGED',
  // the homeward leg is a trip state of its own: opening it and advancing it are
  // both recoverable transitions, so they get the same protection (ADR-045)
  'RETURN_LEG_STATE_CHANGED',
  'BACKHAUL_BOOKING_CREATED',
  'BACKHAUL_BOOKING_STATE_CHANGED',
] as const;
export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number];

/**
 * PENDING    intent recorded, the authoritative write has not been confirmed
 * COMMITTED  MongoDB confirmed it — the event is history, not work to do
 * REPLAYED   was pending through an incident and has since been re-applied
 * ABANDONED  could not be applied and must not be retried (a human decided)
 * SUPERSEDED replay found the effect already present; nothing to do
 */
export const JOURNAL_ENTRY_STATES = [
  'PENDING',
  'COMMITTED',
  'REPLAYED',
  'ABANDONED',
  'SUPERSEDED',
] as const;
export type JournalEntryState = (typeof JOURNAL_ENTRY_STATES)[number];

/**
 * One durable record of intent.
 *
 * `operationKey` is the idempotency anchor and the whole reason replay is safe:
 * it is derived from what the operation IS (its entity and its effect), not from
 * when it ran. Replaying the same key twice therefore finds the effect already
 * present and does nothing, rather than creating a second booking.
 *
 * `payload` carries only what reconciliation needs. No tokens, no bank details,
 * no OTPs, no card data — an append-only file is exactly the wrong place for a
 * secret, and none of them are needed to decide whether an effect landed.
 */
export interface JournalEvent {
  eventId: string;
  eventType: JournalEventType;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operationKey: string;
  payload: Record<string, unknown>;
  state: JournalEntryState;
  schemaVersion: number;
  recordedAt: string;
  committedAt?: string | null;
  /** why it could not be applied, when it could not */
  error?: string | null;
}

export const JOURNAL_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// integrity / reconciliation
// ---------------------------------------------------------------------------

/**
 * AUTO_RECOVERED  the relationship was intact, or a safe derivation restored it
 * RECONSTRUCTED   rebuilt from the journal or from derived state, and it agrees
 * INCONSISTENT    genuinely disagrees — reported, deliberately not "fixed"
 * MANUAL_REVIEW   ambiguous, and guessing would risk money or capacity
 */
export const FINDING_CLASSES = [
  'AUTO_RECOVERED',
  'RECONSTRUCTED',
  'INCONSISTENT',
  'MANUAL_REVIEW',
] as const;
export type FindingClass = (typeof FINDING_CLASSES)[number];

export interface IntegrityFinding {
  check: string;
  classification: FindingClass;
  /** how many records this finding covers */
  count: number;
  detail: string;
  /** a few example ids, so an operator can go and look */
  samples: string[];
}

export interface IntegrityReport {
  ranAt: string;
  passed: boolean;
  checked: number;
  findings: IntegrityFinding[];
}

// ---------------------------------------------------------------------------
// data classification during an incident (§16)
// ---------------------------------------------------------------------------

/**
 * A  restorable from the authoritative backup / PITR
 * B  reconstructable from the durable journal
 * C  last-known operational snapshot — display only, never authoritative
 * D  unrecoverable without a human
 */
export const DATA_CLASSES = ['A_BACKUP', 'B_JOURNAL', 'C_SNAPSHOT', 'D_MANUAL'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

// ---------------------------------------------------------------------------
// what the API returns
// ---------------------------------------------------------------------------

/** The operator's board. */
export interface ResilienceStatusDTO {
  state: RecoveryState;
  /** true while new irreversible actions are being refused */
  writesRestricted: boolean;
  since: string;
  lastHealthyAt: string | null;
  database: DependencyHealth & {
    /** replica-set facts, which is what says HA is real rather than assumed */
    replicaSet: string | null;
    members: number | null;
    serverVersion: string | null;
    /** Continuous Backup / PITR is a control-plane fact the driver cannot see */
    pitr: 'UNVERIFIED' | 'CONFIGURED' | 'UNAVAILABLE';
    pitrDetail: string;
  };
  cache: DependencyHealth;
  journal: JournalHealth;
  /** non-null while a fault is being simulated — never in normal operation */
  simulation: { mode: string; startedAt: string; scope: string[] } | null;
  incident: IncidentDTO | null;
}

export interface IncidentDTO {
  id: string;
  kind: 'INFRASTRUCTURE' | 'DATA_INTEGRITY' | 'SIMULATED';
  detectedAt: string;
  resolvedAt: string | null;
  state: RecoveryState;
  /** the last moment the system is confident the data was good */
  lastKnownGoodAt: string | null;
  restorePoint: string | null;
  stages: Array<{ stage: RecoveryState; at: string; detail: string }>;
  pendingEvents: number;
  replayedEvents: number;
  supersededEvents: number;
  failedEvents: number;
  integrity: IntegrityReport | null;
  snapshotsRebuilt: number | null;
}

/**
 * What a FARMER or TRANSPORTER is told. Deliberately small: a status, a
 * timestamp, and whether their actions will be accepted. No journal contents, no
 * database internals, no counts that only mean something to an operator.
 */
export interface ServiceStatusDTO {
  /** true when everything is normal and nothing needs saying */
  normal: boolean;
  state: RecoveryState;
  /** plain language, safe to render verbatim */
  message: string;
  /** whether new bookings/payments will currently be accepted */
  writesRestricted: boolean;
  /** when the shown data was last known to be authoritative */
  lastSyncedAt: string | null;
}
