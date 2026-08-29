/**
 * Admin-only fault injection (ADR-044, §11 / §25).
 *
 * THE CONSTRAINT THAT SHAPES ALL OF THIS
 * --------------------------------------
 * A demo has to prove the recovery path is real, which means the REAL detector
 * and the REAL recovery controller must run — while not destroying a single row
 * of actual data. So nothing here deletes, corrupts or writes anything. It makes
 * the data-access layer *behave* as though something were wrong:
 *
 *   OUTAGE      every database operation rejects, exactly as a driver timeout
 *               would. Proves: detection, safe mode, snapshot continuity, that
 *               pending intent is journalled and nothing is falsely acknowledged.
 *
 *   CORRUPTION  reads against selected collections reject as unreadable, and the
 *               integrity checker is told to treat that scope as damaged. Proves:
 *               anomaly detection, RECOVERY_REQUIRED, reconciliation, and the
 *               difference from a plain outage — because failover would not fix
 *               this one.
 *
 * Reversible by construction: it is a variable in this process. Clearing it
 * restores normal behaviour instantly, and a process restart clears it anyway. It
 * can never outlive the demo or leak into stored state.
 *
 * The gate is enforced through a global Mongoose plugin (see `installGate`) so it
 * covers every model uniformly, including ones added later — rather than each
 * service remembering to check, which is the version that eventually misses one.
 */
import mongoose from 'mongoose';

export type SimulationMode = 'OUTAGE' | 'CORRUPTION';

interface Simulation {
  mode: SimulationMode;
  startedAt: string;
  /** for CORRUPTION: which collections are being treated as unreadable */
  scope: string[];
}

let active: Simulation | null = null;
let installed = false;

export const currentSimulation = (): Simulation | null => active;

export function startSimulation(mode: SimulationMode, scope: string[] = []): Simulation {
  active = {
    mode,
    startedAt: new Date().toISOString(),
    scope: mode === 'CORRUPTION' ? (scope.length ? scope : DEFAULT_CORRUPTION_SCOPE) : [],
  };
  console.warn(`[resilience] SIMULATION STARTED: ${mode}`, active.scope.join(',') || '(all)');
  return active;
}

export function stopSimulation(): void {
  if (active) console.warn(`[resilience] simulation cleared: ${active.mode}`);
  active = null;
}

/**
 * Collections a corruption demo targets by default.
 *
 * Deliberately the pooled-transport spine: damage here is the interesting case,
 * because trips and shipments are what capacity, pricing and money all hang off.
 * `payments` is excluded — a demo should never make the money layer look broken.
 */
const DEFAULT_CORRUPTION_SCOPE = ['trips', 'tripshipments'];

/** Error thrown by the gate. Shaped like a driver failure so nothing special-cases it. */
export class SimulatedDatabaseError extends Error {
  readonly simulated = true;
  constructor(message: string) {
    super(message);
    this.name = 'MongoNetworkError';
  }
}

/**
 * Should this operation be blocked right now?
 *
 * OUTAGE blocks everything. CORRUPTION blocks only the collections in scope, and
 * only reads — a corrupt collection is unreadable, not un-writable, and keeping
 * that distinction is what makes the two incidents look different in the demo.
 */
export function gateFor(collection: string, isWrite: boolean): SimulatedDatabaseError | null {
  if (!active) return null;

  if (active.mode === 'OUTAGE') {
    return new SimulatedDatabaseError(
      'connection <simulated> to database timed out (blackout simulation)',
    );
  }

  const inScope = active.scope.includes(collection.toLowerCase());
  if (inScope && !isWrite) {
    return new SimulatedDatabaseError(
      `corrupt document detected in collection '${collection}' (blackout simulation)`,
    );
  }
  return null;
}

/**
 * Install the gate on every model.
 *
 * ORDERING MATTERS AND IT BIT ME
 * ------------------------------
 * A Mongoose global plugin only applies to schemas compiled AFTER it is
 * registered. Model files call `model()` at their own module scope, so by the
 * time an `installGate()` inside `main()` ran, every schema already existed and
 * the gate silently applied to nothing — the simulation appeared to start and
 * changed no behaviour at all.
 *
 * So this is invoked as a side effect at the bottom of this module, and
 * `models/index.ts` imports it before it exports a single model. ES module
 * evaluation order then guarantees the plugin is registered first.
 *
 * When no simulation is active every hook is one boolean check and a `next()`,
 * so leaving it permanently installed costs nothing on the normal path.
 */
export function installGate(): void {
  if (installed) return;
  installed = true;
  mongoose.plugin((schema: mongoose.Schema) => {
    const READS = [
      'find',
      'findOne',
      'countDocuments',
      'estimatedDocumentCount',
      'distinct',
      'findOneAndUpdate',
    ] as const;
    const WRITES = [
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
      'findOneAndDelete',
    ] as const;

    for (const op of READS) {
      schema.pre(op as 'find', function (next: (err?: Error) => void) {
        // findOneAndUpdate both reads and writes; treat it as a write for the
        // corruption case so a demo does not block state transitions it did not
        // mean to
        const isWrite = op === 'findOneAndUpdate';
        const err = gateFor(collectionOf(this), isWrite);
        next(err ?? undefined);
      });
    }

    for (const op of WRITES) {
      schema.pre(op as 'updateOne', function (next: (err?: Error) => void) {
        const err = gateFor(collectionOf(this), true);
        next(err ?? undefined);
      });
    }

    schema.pre('save', function (next: (err?: Error) => void) {
      const err = gateFor(this.collection?.collectionName ?? '', true);
      next(err ?? undefined);
    });

    schema.pre('aggregate', function (next: (err?: Error) => void) {
      const model = (this as { model?: () => { collection?: { collectionName?: string } } }).model;
      const collection = typeof model === 'function' ? model()?.collection?.collectionName : '';
      const err = gateFor(collection ?? '', false);
      next(err ?? undefined);
    });

    schema.pre('insertMany', function (next: (err?: Error) => void) {
      const err = gateFor(this.collection?.collectionName ?? '', true);
      next(err ?? undefined);
    });
  });
}

function collectionOf(query: unknown): string {
  const q = query as { mongooseCollection?: { collectionName?: string }; model?: { collection?: { collectionName?: string } } };
  return q.mongooseCollection?.collectionName ?? q.model?.collection?.collectionName ?? '';
}

/*
 * Registered here, at module load, so it precedes every `model()` call. See the
 * ordering note on `installGate` — this line is the fix for a gate that was
 * installed too late to apply to anything.
 */
installGate();
