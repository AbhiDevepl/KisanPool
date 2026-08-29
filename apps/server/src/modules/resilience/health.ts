/**
 * Dependency probes and the recovery state machine (ADR-044).
 *
 * DETECTION IS DEBOUNCED ON PURPOSE
 * ---------------------------------
 * One failed query is not an incident. Networks blip, a primary steps down for a
 * two-second election, a query times out under load. Declaring RECOVERY_REQUIRED
 * on the first error would mean a system that panics more often than it helps —
 * and, worse, one whose alarm nobody believes.
 *
 * So a failure has to persist across `failureThreshold` consecutive probes before
 * the state moves. That is also precisely the window Atlas needs to elect a new
 * primary, which is the point: an infrastructure failure should heal itself
 * inside the debounce and never reach the operator at all.
 *
 * THE TWO INCIDENTS ARE DIAGNOSED DIFFERENTLY
 * -------------------------------------------
 *   unreachable, repeatedly            → INFRASTRUCTURE. Wait for failover. The
 *                                        data is fine; restoring would be wrong.
 *   reachable but the data is wrong    → DATA_INTEGRITY. Failover cannot help,
 *                                        because every replica has the same
 *                                        damage. This is what PITR is for.
 */
import mongoose from 'mongoose';
import {
  RESTRICTED_STATES,
  type DependencyHealth,
  type IncidentDTO,
  type RecoveryState,
} from '@kisanpool/shared';
import { config } from '../../config';
import { journalHealth, redisHealth } from './journal';
import { currentSimulation, gateFor } from './simulation';

// ---------------------------------------------------------------------------
// probe state
// ---------------------------------------------------------------------------

const blank = (detail: string): DependencyHealth => ({
  state: 'DOWN',
  latencyMs: null,
  consecutiveFailures: 0,
  detail,
  checkedAt: new Date().toISOString(),
});

let database: DependencyHealth = blank('not probed yet');
let cache: DependencyHealth = blank('not probed yet');

/** Facts about the cluster, read once when it is reachable. */
let clusterFacts: {
  replicaSet: string | null;
  members: number | null;
  serverVersion: string | null;
} = { replicaSet: null, members: null, serverVersion: null };

let state: RecoveryState = 'HEALTHY';
let stateSince = new Date().toISOString();
let lastHealthyAt: string | null = null;
let incident: IncidentDTO | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export const recoveryState = (): RecoveryState => state;
export const currentIncident = (): IncidentDTO | null => incident;
export const databaseHealth = (): DependencyHealth => database;
export const cacheHealth = (): DependencyHealth => cache;
export const clusterInfo = () => clusterFacts;
export const lastHealthy = (): string | null => lastHealthyAt;
export const writesRestricted = (): boolean => RESTRICTED_STATES.includes(state);

/**
 * Move the state machine, recording each stage on the incident so the operator
 * board shows a history rather than only a current value.
 */
export function setState(next: RecoveryState, detail: string): void {
  if (state === next) return;
  console.warn(`[resilience] ${state} → ${next}: ${detail}`);
  state = next;
  stateSince = new Date().toISOString();
  if (incident) {
    incident.state = next;
    incident.stages.push({ stage: next, at: stateSince, detail });
    if (next === 'RECOVERED' || next === 'HEALTHY') incident.resolvedAt = stateSince;
  }
}

export const stateSinceAt = (): string => stateSince;

export function openIncident(
  kind: IncidentDTO['kind'],
  detail: string,
): IncidentDTO {
  if (incident && !incident.resolvedAt) return incident;
  incident = {
    id: `inc_${Date.now().toString(36)}`,
    kind,
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
    state,
    lastKnownGoodAt: lastHealthyAt,
    restorePoint: null,
    stages: [{ stage: state, at: new Date().toISOString(), detail }],
    pendingEvents: journalHealth().pending,
    replayedEvents: 0,
    supersededEvents: 0,
    failedEvents: 0,
    integrity: null,
    snapshotsRebuilt: null,
  };
  console.warn(`[resilience] incident ${incident.id} opened: ${kind} — ${detail}`);
  return incident;
}

export function updateIncident(patch: Partial<IncidentDTO>): void {
  if (incident) Object.assign(incident, patch);
}

export function closeIncident(): void {
  if (incident && !incident.resolvedAt) incident.resolvedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// the probes
// ---------------------------------------------------------------------------

async function probeDatabase(): Promise<DependencyHealth> {
  const started = Date.now();
  const previousFailures = database.consecutiveFailures;

  try {
    /*
     * The probe uses a RAW driver command, which does not pass through Mongoose
     * model middleware — so the simulation gate would never be seen here. An
     * outage simulation in which the health probe reports UP is a simulation
     * that proves nothing, so the gate is consulted explicitly (ADR-044).
     */
    const simulated = gateFor('__healthprobe', false);
    if (simulated) throw simulated;

    const admin = mongoose.connection.db?.admin();
    if (!admin) throw new Error('no connection');

    // `ping` is the cheapest honest liveness check
    await admin.command({ ping: 1 });
    const latencyMs = Date.now() - started;

    // learn the cluster's shape once — this is what says HA is real, not assumed
    if (!clusterFacts.replicaSet) {
      try {
        const hello = await admin.command({ hello: 1 });
        clusterFacts = {
          replicaSet: hello.setName ?? null,
          members: Array.isArray(hello.hosts) ? hello.hosts.length : null,
          serverVersion: clusterFacts.serverVersion,
        };
        const build = await admin.command({ buildInfo: 1 }).catch(() => null);
        if (build?.version) clusterFacts.serverVersion = build.version;
      } catch {
        // shared tiers restrict admin commands; not knowing is not a failure
      }
    }

    lastHealthyAt = new Date().toISOString();
    return {
      state: latencyMs > 2000 ? 'DEGRADED' : 'UP',
      latencyMs,
      consecutiveFailures: 0,
      detail:
        latencyMs > 2000
          ? `responding slowly (${latencyMs}ms)`
          : `${clusterFacts.replicaSet ? `replica set ${clusterFacts.replicaSet}, ` : ''}${clusterFacts.members ?? '?'} members`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      state: 'DOWN',
      latencyMs: null,
      consecutiveFailures: previousFailures + 1,
      detail: (err as Error)?.message?.slice(0, 120) ?? 'unreachable',
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * A cheap spot check that the core data is actually READABLE.
 *
 * This is what separates the two incidents. A `ping` proves the server is
 * answering; it proves nothing about whether the data is intact. Corruption,
 * a dropped collection or an unreadable index leaves the connection perfectly
 * healthy and the application perfectly broken — and because replication copies
 * the damage to every member, failover would not help.
 *
 * So: touch the collections the business actually depends on. Reachable but
 * unreadable is diagnosed as DATA_INTEGRITY, which is the incident PITR exists
 * for, rather than as an outage the system would otherwise sit and wait out.
 *
 * Returns null when everything reads, or the failing detail when it does not.
 */
async function probeReadability(): Promise<string | null> {
  try {
    const { Trip, TripShipment } = await import('../../models');
    await Trip.estimatedDocumentCount();
    await TripShipment.estimatedDocumentCount();
    return null;
  } catch (err) {
    return (err as Error)?.message?.slice(0, 120) ?? 'core collections unreadable';
  }
}

function probeCache(): DependencyHealth {
  const redis = redisHealth();
  if (!config.redis.enabled) {
    return {
      state: 'NOT_CONFIGURED',
      latencyMs: null,
      consecutiveFailures: 0,
      // absence is a supported mode, not a fault — say so plainly
      detail: 'REDIS_URL not set; snapshots use an in-process store and the journal uses disk',
      checkedAt: new Date().toISOString(),
    };
  }
  return {
    state: redis.reachable ? (redis.aof ? 'UP' : 'DEGRADED') : 'DOWN',
    latencyMs: null,
    consecutiveFailures: redis.reachable ? 0 : cache.consecutiveFailures + 1,
    detail: redis.detail,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * One health cycle: probe, then decide whether the state should move.
 *
 * The decision deliberately only ESCALATES automatically. Coming back from
 * RECOVERY_REQUIRED runs through reconciliation and validation (see recovery.ts)
 * rather than flipping straight to HEALTHY the moment the database answers — a
 * database that is reachable again is not the same as a database that is correct
 * again, and only the second is worth telling users about.
 */
export async function runHealthCycle(): Promise<void> {
  database = await probeDatabase();
  cache = probeCache();

  const threshold = config.resilience.failureThreshold;
  const dbDown = database.state === 'DOWN';

  // an operator-driven recovery is in progress — the probe must not fight it
  if (['RESTORING', 'RECONCILING', 'VALIDATING'].includes(state)) return;

  if (dbDown && database.consecutiveFailures >= threshold) {
    if (state !== 'RECOVERY_REQUIRED') {
      const simulated = currentSimulation();
      openIncident(
        simulated ? 'SIMULATED' : 'INFRASTRUCTURE',
        `database unreachable for ${database.consecutiveFailures} consecutive probes`,
      );
      setState(
        'RECOVERY_REQUIRED',
        simulated
          ? `simulated ${simulated.mode.toLowerCase()}`
          : 'database unreachable past the failure threshold',
      );
    }
    return;
  }

  if (dbDown) {
    // failing, but inside the debounce — this is where an Atlas election lives
    setState('DEGRADED', `database probe failing (${database.consecutiveFailures}/${threshold})`);
    return;
  }

  /*
   * The connection is fine. Now the different question: is the DATA readable?
   * Reachable-but-unreadable is the corruption case, and it needs a restore, not
   * a failover — so it is diagnosed separately and never waits for a failover
   * that cannot help it.
   */
  const unreadable = await probeReadability();
  if (unreadable) {
    if (state !== 'RECOVERY_REQUIRED') {
      openIncident(
        currentSimulation() ? 'SIMULATED' : 'DATA_INTEGRITY',
        `database is reachable but core collections are unreadable: ${unreadable}`,
      );
      setState(
        'RECOVERY_REQUIRED',
        'data integrity anomaly — failover cannot fix this; a point-in-time restore is required',
      );
    }
    database = { ...database, state: 'DEGRADED', detail: `data unreadable: ${unreadable}` };
    return;
  }

  // database is answering
  if (state === 'RECOVERY_REQUIRED' && incident?.kind !== 'DATA_INTEGRITY') {
    // it healed itself: an infrastructure blip, exactly what HA is for. Pending
    // journal intent still has to be reconciled before this counts as healthy.
    setState('RECONCILING', 'database reachable again — reconciling pending operations');
    return;
  }

  if (state === 'DEGRADED' || state === 'HEALTHY' || state === 'RECOVERED') {
    const cacheUnhappy = cache.state === 'DOWN';
    if (cacheUnhappy) {
      setState('DEGRADED', 'cache unavailable — serving directly from the database');
    } else if (state !== 'HEALTHY') {
      setState('HEALTHY', 'all dependencies nominal');
      closeIncident();
    }
  }
}

export function startHealthLoop(): void {
  if (timer) return;
  void runHealthCycle();
  timer = setInterval(() => void runHealthCycle(), config.resilience.probeIntervalMs);
  // never hold the process open just for a health probe
  timer.unref?.();
}

export function stopHealthLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test/demo support: force the machine back to a known baseline. */
export function resetHealth(): void {
  state = 'HEALTHY';
  stateSince = new Date().toISOString();
  incident = null;
  database = { ...database, consecutiveFailures: 0 };
  cache = { ...cache, consecutiveFailures: 0 };
}
