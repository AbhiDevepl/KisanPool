/**
 * The durable recovery journal (ADR-044).
 *
 * WHY THIS CANNOT LIVE IN MONGODB
 * -------------------------------
 * It records what the application intended to do so that an operation in flight
 * when the database went away is not simply lost. A journal stored in the thing
 * it is protecting against is not a journal. So it writes somewhere else, and it
 * has to still be there after a crash — which means an fsync, not a buffer.
 *
 * WHY IT IS NOT "JUST REDIS"
 * --------------------------
 * Redis is only durable if it is configured to be. A default cache-mode Redis
 * acknowledges a write, keeps it in memory, and can lose it on restart — which is
 * fine for a cached ETA and catastrophic for a pending booking. So this module
 * ASKS Redis (`CONFIG GET appendonly`) instead of assuming, and only treats it as
 * durable when AOF is actually on. A cache-only Redis is reported as such and is
 * NOT used to hold intent; the file journal takes over.
 *
 *   FILE              always available, fsync'd append-only. The default, and the
 *                     honest floor: a single node's disk.
 *   REDIS_AOF         AOF confirmed on. Preferred for multi-instance deployments,
 *                     because a file journal is local to one process.
 *   REDIS_CACHE_ONLY  reachable but NOT durable — refused for intent, and said so.
 *
 * APPEND-ONLY, AND WHY STATE CHANGES ARE ALSO APPENDS
 * ---------------------------------------------------
 * Nothing is ever edited in place. Marking an event committed appends a new line
 * for the same eventId; the current state of an event is the LAST line that
 * mentions it. That is what makes a torn write at the moment of a crash harmless:
 * a half-written trailing line is discarded on read and the previous state stands.
 */
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  JOURNAL_SCHEMA_VERSION,
  type JournalBackend,
  type JournalEntryState,
  type JournalEvent,
  type JournalEventType,
  type JournalHealth,
} from '@kisanpool/shared';
import { config } from '../../config';

// ---------------------------------------------------------------------------
// the backend contract
// ---------------------------------------------------------------------------

interface JournalBackendImpl {
  readonly kind: JournalBackend;
  readonly durable: boolean;
  append(line: string): Promise<void>;
  readAll(): Promise<string[]>;
  detail: string;
}

// ---------------------------------------------------------------------------
// file backend — the always-available floor
// ---------------------------------------------------------------------------

class FileJournal implements JournalBackendImpl {
  readonly kind: JournalBackend = 'FILE';
  readonly durable = true;
  detail: string;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.detail = `append-only file at ${file}`;
  }

  async append(line: string): Promise<void> {
    /*
     * Open, write, FSYNC, close. The fsync is the entire point — without it the
     * line sits in the OS page cache and a power loss takes it with everything
     * else. It costs a few milliseconds and it is only paid on critical
     * mutations, which is precisely where that trade is worth making.
     */
    const handle = await fs.promises.open(this.file, 'a');
    try {
      await handle.write(`${line}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async readAll(): Promise<string[]> {
    try {
      const raw = await fs.promises.readFile(this.file, 'utf8');
      return raw.split('\n').filter(Boolean);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// redis backend — used only when it proves it is durable
// ---------------------------------------------------------------------------

interface MinimalRedis {
  rPush(key: string, value: string): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  configGet(param: string): Promise<Record<string, string>>;
  ping(): Promise<string>;
  set(key: string, value: string, opts?: unknown): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string | string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<unknown>;
  isOpen?: boolean;
}

class RedisJournal implements JournalBackendImpl {
  readonly kind: JournalBackend;
  readonly durable: boolean;
  detail: string;
  private readonly client: MinimalRedis;
  private readonly key = 'kisanpool:journal';

  constructor(client: MinimalRedis, aofEnabled: boolean) {
    this.client = client;
    this.kind = aofEnabled ? 'REDIS_AOF' : 'REDIS_CACHE_ONLY';
    this.durable = aofEnabled;
    this.detail = aofEnabled
      ? 'Redis list with AOF persistence confirmed (appendonly yes)'
      : 'Redis reachable but AOF is OFF — treated as a cache, not used for intent';
  }

  async append(line: string): Promise<void> {
    await this.client.rPush(this.key, line);
  }

  async readAll(): Promise<string[]> {
    return this.client.lRange(this.key, 0, -1);
  }
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

let backend: JournalBackendImpl | null = null;
let redisClient: MinimalRedis | null = null;
let redisState: { reachable: boolean; aof: boolean; detail: string } = {
  reachable: false,
  aof: false,
  detail: 'REDIS_URL not configured — operating without a cache layer',
};

/** In-memory index of the current state of each event, rebuilt on load. */
const index = new Map<string, JournalEvent>();
/** operationKey → eventId, so a repeat of the same intent is recognised. */
const byOperationKey = new Map<string, string>();

export function redisHealth(): { reachable: boolean; aof: boolean; detail: string } {
  return redisState;
}

export function redisConnection(): MinimalRedis | null {
  return redisClient && redisClient.isOpen !== false ? redisClient : null;
}

/**
 * Connect Redis if configured, and — crucially — ask whether it is durable
 * rather than assuming. Never throws: Redis being absent is a supported mode
 * (CASE 3), not a startup failure.
 */
async function tryRedis(): Promise<{ client: MinimalRedis; aof: boolean } | null> {
  if (!config.redis.url) return null;
  try {
    // imported lazily so the dependency is genuinely optional
    const mod = (await import('redis')) as unknown as {
      createClient: (opts: { url: string }) => MinimalRedis & {
        connect: () => Promise<unknown>;
        on: (e: string, cb: (err: unknown) => void) => unknown;
      };
    };
    const client = mod.createClient({ url: config.redis.url });
    // a connection error must not become an unhandled rejection that kills the process
    client.on('error', () => undefined);
    await client.connect();
    await client.ping();

    let aof = false;
    let detail = 'connected';
    try {
      const cfg = await client.configGet('appendonly');
      aof = String(cfg.appendonly ?? 'no').toLowerCase() === 'yes';
      detail = aof
        ? 'connected, AOF persistence ON'
        : 'connected, AOF persistence OFF — cache only';
    } catch {
      // managed Redis often forbids CONFIG GET. Unverifiable is NOT the same as
      // verified-durable, so it is treated as a cache.
      detail = 'connected, but CONFIG GET is not permitted — durability unverified, treated as cache';
    }

    redisState = { reachable: true, aof, detail };
    return { client, aof };
  } catch (err) {
    redisState = {
      reachable: false,
      aof: false,
      detail: `unreachable: ${(err as Error)?.message?.slice(0, 80) ?? 'unknown'}`,
    };
    return null;
  }
}

/**
 * Bring the journal up and replay its contents into memory.
 *
 * Called once at boot. If Redis is configured and durable it is used; otherwise
 * the file journal is, and the application is told which so it can say so out
 * loud rather than implying a durability it does not have.
 */
export async function initJournal(): Promise<JournalHealth> {
  const redis = await tryRedis();
  redisClient = redis?.client ?? null;

  if (redis?.aof) {
    backend = new RedisJournal(redis.client, true);
  } else {
    backend = new FileJournal(config.resilience.journalFile);
    if (redis) {
      backend.detail += ' (Redis present but not durable, so intent is kept on disk)';
    }
  }

  await loadIndex();
  return journalHealth();
}

async function loadIndex(): Promise<void> {
  index.clear();
  byOperationKey.clear();
  if (!backend) return;

  const lines = await backend.readAll();
  for (const line of lines) {
    let event: JournalEvent;
    try {
      event = JSON.parse(line) as JournalEvent;
    } catch {
      // a torn trailing line from a crash mid-append. Discarding it is correct:
      // the previous state of that event still stands.
      continue;
    }
    if (!event?.eventId) continue;
    index.set(event.eventId, event);
    if (event.operationKey) byOperationKey.set(event.operationKey, event.eventId);
  }
}

export function journalHealth(): JournalHealth {
  const all = [...index.values()];
  return {
    backend: backend?.kind ?? 'NONE',
    durable: backend?.durable ?? false,
    pending: all.filter((e) => e.state === 'PENDING').length,
    failed: all.filter((e) => e.state === 'ABANDONED').length,
    detail: backend?.detail ?? 'journal not initialised',
  };
}

// ---------------------------------------------------------------------------
// recording intent
// ---------------------------------------------------------------------------

/**
 * A stable idempotency key for an operation.
 *
 * Built from WHAT the operation is, never from when it ran or a random value —
 * that is what makes a replay recognise itself. Two attempts at the same business
 * effect hash to the same key; two genuinely different effects do not.
 */
export function operationKey(
  eventType: JournalEventType,
  entityId: string,
  discriminator = '',
): string {
  return createHash('sha256')
    .update(`${eventType}:${entityId}:${discriminator}`)
    .digest('hex')
    .slice(0, 32);
}

async function write(event: JournalEvent): Promise<void> {
  if (!backend) return;
  await backend.append(JSON.stringify(event));
  index.set(event.eventId, event);
  if (event.operationKey) byOperationKey.set(event.operationKey, event.eventId);
}

export interface RecordInput {
  eventType: JournalEventType;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  operationKey: string;
  payload?: Record<string, unknown>;
}

/**
 * Record the INTENT to perform a critical mutation, before attempting it.
 *
 * Returns the event so the caller can commit or fail it. Journal problems are
 * swallowed deliberately: a disk hiccup must not take down a booking that
 * MongoDB is perfectly able to accept. The journal makes recovery possible; it
 * is not itself a precondition for serving a request.
 */
export async function recordIntent(input: RecordInput): Promise<JournalEvent | null> {
  if (!backend) return null;

  const existingId = byOperationKey.get(input.operationKey);
  const existing = existingId ? index.get(existingId) : undefined;
  // the same intent already landed — do not open a second event for it
  if (existing && ['COMMITTED', 'REPLAYED', 'SUPERSEDED'].includes(existing.state)) {
    return existing;
  }

  const event: JournalEvent = {
    eventId: existing?.eventId ?? randomUUID(),
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    operationKey: input.operationKey,
    payload: input.payload ?? {},
    state: 'PENDING',
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
  };

  try {
    await write(event);
    return event;
  } catch (err) {
    console.warn('[journal] could not record intent', (err as Error)?.message);
    return null;
  }
}

/** Mark an event applied, once the AUTHORITATIVE store has confirmed it. */
export async function markCommitted(
  event: JournalEvent | null,
  state: JournalEntryState = 'COMMITTED',
): Promise<void> {
  if (!event || !backend) return;
  try {
    await write({ ...event, state, committedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('[journal] could not mark committed', (err as Error)?.message);
  }
}

/** Mark an event as un-appliable. Requires a reason; nothing is abandoned silently. */
export async function markAbandoned(event: JournalEvent, error: string): Promise<void> {
  if (!backend) return;
  await write({ ...event, state: 'ABANDONED', error });
}

export async function markReplayed(
  event: JournalEvent,
  state: 'REPLAYED' | 'SUPERSEDED',
): Promise<void> {
  if (!backend) return;
  await write({ ...event, state, committedAt: new Date().toISOString() });
}

/**
 * Run a critical mutation write-ahead: record intent → do it → mark committed.
 *
 * If the work throws, the event stays PENDING and is picked up by reconciliation
 * after the database returns. The caller still sees the error — this wrapper
 * never converts a failure into a false success, which is the single most
 * important property of the whole layer.
 */
export async function withJournal<T>(
  input: RecordInput,
  work: () => Promise<T>,
): Promise<T> {
  const event = await recordIntent(input);
  try {
    const result = await work();
    await markCommitted(event);
    return result;
  } catch (err) {
    // left PENDING on purpose: it is now reconciliation's problem, not a lie
    throw err;
  }
}

// ---------------------------------------------------------------------------
// reads, for reconciliation and the operator board
// ---------------------------------------------------------------------------

export const pendingEvents = (): JournalEvent[] =>
  [...index.values()]
    .filter((e) => e.state === 'PENDING')
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

export const allEvents = (limit = 200): JournalEvent[] =>
  [...index.values()]
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, limit);

export const eventCount = (): number => index.size;

/** Test/demo support: forget the in-memory index and re-read from the backend. */
export async function reloadJournal(): Promise<void> {
  await loadIndex();
}
