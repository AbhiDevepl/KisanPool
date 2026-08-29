/**
 * Resilience endpoints (ADR-044).
 *
 * TWO AUDIENCES, TWO VERY DIFFERENT AMOUNTS OF DETAIL
 * ---------------------------------------------------
 *   /service-status  ANY signed-in user. A state, a sentence, a timestamp and
 *                    whether their actions will be accepted. Nothing else — a
 *                    farmer has no use for journal contents and no business
 *                    seeing collection names or failure counts.
 *
 *   /admin/resilience/*  requireAdmin. The full board, the simulation controls
 *                    and the replay controls. Every one of these is an operator
 *                    capability and none is reachable with a marketplace token.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAdmin, requireAuth, type AuthedRequest } from '../../middleware/auth';
import {
  type ResilienceStatusDTO,
  type ServiceStatusDTO,
} from '@kisanpool/shared';
import { config } from '../../config';
import {
  cacheHealth,
  clusterInfo,
  currentIncident,
  databaseHealth,
  lastHealthy,
  recoveryState,
  resetHealth,
  runHealthCycle,
  setState,
  stateSinceAt,
  writesRestricted,
} from './health';
import { allEvents, connectRedis, disableRedis, journalHealth } from './journal';
import { runIntegrityChecks } from './integrity';
import { abandonEvent, rebuildSnapshots, replayPending, runRecovery } from './recovery';
import { currentSimulation, startSimulation, stopSimulation } from './simulation';

export const resilienceRouter = Router();
export const adminResilienceRouter = Router();

// ---------------------------------------------------------------------------
// what users are told
// ---------------------------------------------------------------------------

/**
 * Plain language for each state.
 *
 * None of these say "everything is fine" unless it is, and none of them invent a
 * completion time. A farmer being told "recovery in progress" and shown a
 * timestamp is better served than one shown a spinner or a false success.
 */
function userMessage(): { message: string; normal: boolean } {
  switch (recoveryState()) {
    case 'HEALTHY':
      return { message: 'All systems normal.', normal: true };
    case 'DEGRADED':
      return {
        message: 'Running normally. Some background services are slower than usual.',
        normal: true,
      };
    case 'RECOVERY_REQUIRED':
    case 'RESTORING':
      return {
        message:
          'System recovery in progress. You can still see your trip as it was last saved. New bookings and payments are paused until this finishes.',
        normal: false,
      };
    case 'RECONCILING':
      return {
        message:
          'Service is coming back. We are checking recent activity before accepting new bookings.',
        normal: false,
      };
    case 'VALIDATING':
      return { message: 'Almost back. Final checks are running.', normal: false };
    case 'RECOVERED':
      return { message: 'Service has been restored.', normal: true };
    case 'MANUAL_REVIEW':
      return {
        message:
          'Service is running. Our team is reviewing a small number of records from a recent incident.',
        normal: true,
      };
    default:
      return { message: 'Service status unknown.', normal: false };
  }
}

/** Signed-in users: the honest minimum. */
resilienceRouter.get(
  '/service-status',
  requireAuth,
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const { message, normal } = userMessage();
    const dto: ServiceStatusDTO = {
      normal,
      state: recoveryState(),
      message,
      writesRestricted: writesRestricted(),
      lastSyncedAt: lastHealthy(),
    };
    ok(res, dto);
  }),
);

// ---------------------------------------------------------------------------
// the operator board
// ---------------------------------------------------------------------------

function statusDto(): ResilienceStatusDTO {
  const cluster = clusterInfo();
  const simulation = currentSimulation();

  return {
    state: recoveryState(),
    writesRestricted: writesRestricted(),
    since: stateSinceAt(),
    lastHealthyAt: lastHealthy(),
    database: {
      ...databaseHealth(),
      replicaSet: cluster.replicaSet,
      members: cluster.members,
      serverVersion: cluster.serverVersion,
      /*
       * Continuous Backup / PITR is an Atlas CONTROL-PLANE fact. The database
       * driver genuinely cannot see it, so this reports UNVERIFIED rather than
       * claiming a capability the application has no way to confirm. Verifying
       * it is a documented manual step (docs/RESILIENCE.md).
       */
      pitr: 'UNVERIFIED',
      pitrDetail:
        cluster.members && cluster.members > 1
          ? `Replica set with ${cluster.members} members — automatic failover is available. Continuous Backup / PITR must be confirmed in the Atlas UI or Admin API; it is not visible to the driver.`
          : 'Cluster topology not yet determined.',
    },
    cache: cacheHealth(),
    journal: journalHealth(),
    simulation: simulation
      ? { mode: simulation.mode, startedAt: simulation.startedAt, scope: simulation.scope }
      : null,
    incident: currentIncident(),
  };
}

adminResilienceRouter.get(
  '/status',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    // probe on demand so the board is never showing a stale cycle
    await runHealthCycle();
    ok(res, statusDto());
  }),
);

/** The journal, for an operator working through an incident. Never user-facing. */
adminResilienceRouter.get(
  '/journal',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().min(1).max(500).default(100) }).parse(req.query);
    ok(res, { health: journalHealth(), events: allEvents(limit) });
  }),
);

adminResilienceRouter.get(
  '/integrity',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, await runIntegrityChecks());
  }),
);

/** Replay alone, without the full recovery sequence. Idempotent. */
adminResilienceRouter.post(
  '/replay',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, await replayPending());
  }),
);

adminResilienceRouter.post(
  '/rebuild-snapshots',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, { rebuilt: await rebuildSnapshots() });
  }),
);

/**
 * The full sequence: reconcile → validate → rebuild.
 *
 * `restorePoint` is recorded for the audit trail. It does NOT perform an Atlas
 * restore — that is a control-plane action deliberately kept behind a human.
 */
adminResilienceRouter.post(
  '/recover',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { restorePoint } = z
      .object({ restorePoint: z.string().datetime().optional() })
      .parse(req.body ?? {});
    ok(res, await runRecovery({ restorePoint }));
  }),
);

adminResilienceRouter.post(
  '/journal/:eventId/abandon',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(1).max(200) }).parse(req.body);
    const done = await abandonEvent(req.params.eventId, reason);
    if (!done) throw new ApiError('RESOURCE_NOT_FOUND', 'No pending journal entry with that id.');
    ok(res, { abandoned: req.params.eventId });
  }),
);

// ---------------------------------------------------------------------------
// simulation — reversible, isolated, and it destroys nothing
// ---------------------------------------------------------------------------

/**
 * Start a controlled fault.
 *
 * OUTAGE     the database layer rejects everything, as a driver timeout would.
 * CORRUPTION reads against the named collections reject as unreadable.
 *
 * Neither writes, deletes or alters a single document. The effect is a variable
 * in this process: clearing it — or restarting — restores normal behaviour
 * immediately, so a simulation can never outlive the demo.
 */
adminResilienceRouter.post(
  '/simulate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        mode: z.enum(['OUTAGE', 'CORRUPTION']),
        scope: z.array(z.string().min(1).max(60)).max(10).optional(),
      })
      .parse(req.body);

    if (config.isProd && process.env.ALLOW_PROD_SIMULATION !== 'true') {
      throw new ApiError(
        'AUTH_FORBIDDEN',
        'Fault simulation is disabled in production. Set ALLOW_PROD_SIMULATION=true to override deliberately.',
      );
    }

    const simulation = startSimulation(body.mode, body.scope);

    // drive the real detector rather than setting the state directly — the point
    // of the demo is that the production path is what runs
    await runHealthCycle();

    ok(res, { simulation, state: recoveryState() });
  }),
);

/** Clear the fault. The recovery sequence is a separate, explicit step. */
adminResilienceRouter.post(
  '/simulate/stop',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    stopSimulation();
    await runHealthCycle();
    ok(res, { cleared: true, state: recoveryState() });
  }),
);

// ---------------------------------------------------------------------------
// Redis on/off — for testing the failure matrix live
// ---------------------------------------------------------------------------

/**
 * Switch Redis OFF at runtime.
 *
 * This is failure-matrix CASE 3: cache gone, database healthy. The application
 * must simply keep working — snapshots fall back to the in-process store and the
 * journal keeps using the fsync'd file it was already writing to.
 *
 * Safe by construction: the file journal holds every entry regardless of Redis,
 * so switching it off strands nothing. Fully reversible.
 */
adminResilienceRouter.post(
  '/redis/disable',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const journal = await disableRedis();
    await runHealthCycle();
    ok(res, { redis: cacheHealth(), journal, state: recoveryState() });
  }),
);

/**
 * Connect or reconnect Redis.
 *
 * `url` is optional and overrides `REDIS_URL` for this process — useful when
 * Redis was started after the server, or to point at a different instance,
 * without an env change and a restart. AOF is re-verified on every connect:
 * a Redis that cannot prove it persists is used for snapshots only.
 */
adminResilienceRouter.post(
  '/redis/enable',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { url } = z
      .object({ url: z.string().min(1).max(200).optional() })
      .parse(req.body ?? {});

    const journal = await connectRedis(url);
    await runHealthCycle();

    const health = cacheHealth();
    ok(res, {
      redis: health,
      journal,
      state: recoveryState(),
      // say plainly whether it is trusted with intent, and why
      trustedForIntent: journal.backend === 'REDIS_AOF',
      note:
        journal.backend === 'REDIS_AOF'
          ? 'AOF confirmed — Redis is mirroring the recovery journal.'
          : health.state === 'DOWN'
            ? 'Could not connect. The app continues on MongoDB with an in-process snapshot store.'
            : 'Connected, but AOF is not confirmed — Redis is used for snapshots only, never for pending intent.',
    });
  }),
);

/**
 * Reset the controller to a clean baseline.
 *
 * Clears any simulation and any open incident. For demos and tests — it changes
 * no application data, only this module's own view of the world.
 */
adminResilienceRouter.post(
  '/reset',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    stopSimulation();
    resetHealth();
    setState('HEALTHY', 'controller reset by an operator');
    await runHealthCycle();
    ok(res, { state: recoveryState() });
  }),
);
