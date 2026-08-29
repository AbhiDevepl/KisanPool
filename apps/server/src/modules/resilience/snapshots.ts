/**
 * Operational snapshots — last-known-good READ state (ADR-044).
 *
 * WHAT THIS IS FOR
 * ----------------
 * When the database is unreachable, a farmer should still be able to open their
 * trip and see where the truck was, what their share is and when that was true —
 * instead of a spinner or a crash. That is all this is: a small, expiring,
 * clearly-timestamped copy of things that are cheap to lose.
 *
 * WHAT IT IS EMPHATICALLY NOT
 * ---------------------------
 * It is not a write path and it is not authoritative. Nothing is ever booked,
 * priced, paid or completed from a snapshot. Every value handed out carries the
 * moment it was captured, and callers render it as "as of HH:MM", never as
 * current truth. Losing the entire snapshot store costs nothing but freshness —
 * which is exactly why it is allowed to live in a cache, while pending INTENT is
 * not (see journal.ts).
 *
 * BACKEND
 * -------
 * Redis when configured (shared across instances), otherwise an in-process Map.
 * The Map is a genuine fallback rather than a stub: a single-instance deployment
 * loses nothing by using it, and CASE 3 of the failure matrix — Redis down,
 * Mongo healthy — must simply keep working.
 */
import { config } from '../../config';
import { redisConnection } from './journal';

export interface Snapshot<T> {
  value: T;
  capturedAt: string;
}

/** In-process fallback. Bounded so a long uptime cannot leak memory. */
const memory = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_LIMIT = 5000;

const now = (): number => Date.now();

function pruneMemory(): void {
  if (memory.size <= MEMORY_LIMIT) return;
  const stale = [...memory.entries()]
    .filter(([, v]) => v.expiresAt < now())
    .map(([k]) => k);
  for (const key of stale) memory.delete(key);
  // still over the limit: drop the oldest-expiring entries
  if (memory.size > MEMORY_LIMIT) {
    const byExpiry = [...memory.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of byExpiry.slice(0, memory.size - MEMORY_LIMIT)) memory.delete(key);
  }
}

const namespaced = (key: string): string => `kisanpool:snap:${key}`;

/**
 * Store a snapshot. Best-effort by design: a cache write must never be able to
 * fail the request that produced it.
 */
export async function putSnapshot<T>(
  key: string,
  value: T,
  ttlSeconds = config.resilience.snapshotTtlSeconds,
): Promise<void> {
  const record: Snapshot<T> = { value, capturedAt: new Date().toISOString() };
  const encoded = JSON.stringify(record);

  const redis = redisConnection();
  if (redis) {
    try {
      await redis.set(namespaced(key), encoded, { EX: ttlSeconds });
      return;
    } catch {
      // fall through to memory — Redis being unavailable is a supported mode
    }
  }

  memory.set(namespaced(key), { value: encoded, expiresAt: now() + ttlSeconds * 1000 });
  pruneMemory();
}

/** Read a snapshot, or null when there is none / it has expired. */
export async function getSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const redis = redisConnection();
  if (redis) {
    try {
      const raw = await redis.get(namespaced(key));
      if (raw) return JSON.parse(raw) as Snapshot<T>;
    } catch {
      // fall through
    }
  }

  const hit = memory.get(namespaced(key));
  if (!hit) return null;
  if (hit.expiresAt < now()) {
    memory.delete(namespaced(key));
    return null;
  }
  return JSON.parse(hit.value) as Snapshot<T>;
}

/**
 * Drop snapshots after a restore.
 *
 * Stale continuity state is worse than none: it describes a world that the
 * restored database may no longer agree with. Snapshots are therefore cleared
 * and rebuilt from authoritative state, never merged with it (§14).
 */
export async function clearSnapshots(prefix = ''): Promise<number> {
  const pattern = namespaced(`${prefix}*`);
  let cleared = 0;

  const redis = redisConnection();
  if (redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length) {
        await redis.del(keys);
        cleared += keys.length;
      }
    } catch {
      // fall through and at least clear memory
    }
  }

  for (const key of [...memory.keys()]) {
    if (key.startsWith(namespaced(prefix))) {
      memory.delete(key);
      cleared += 1;
    }
  }
  return cleared;
}

// ---------------------------------------------------------------------------
// the specific things worth keeping
// ---------------------------------------------------------------------------

export const tripKey = (tripId: string): string => `trip:${tripId}`;
export const vehicleKey = (vehicleId: string): string => `vehicle:${vehicleId}`;

export interface TripSnapshot {
  tripId: string;
  state: string;
  destination: string;
  routeDistanceKm: number;
  capacity: { totalKg: number; committedKg: number; loadedKg: number; availableKg: number };
  poolSize: number;
  pricingVersion: number;
  totalCost: number | null;
  shipments: Array<{
    shipmentId: string;
    farmerId: string;
    state: string;
    amount: number | null;
  }>;
}

export interface VehicleSnapshot {
  vehicleId: string;
  lat: number;
  lng: number;
  etaMinutes: number | null;
}

export const putTripSnapshot = (trip: TripSnapshot): Promise<void> =>
  putSnapshot(tripKey(trip.tripId), trip);

export const readTripSnapshot = (tripId: string): Promise<Snapshot<TripSnapshot> | null> =>
  getSnapshot<TripSnapshot>(tripKey(tripId));

export const putVehicleSnapshot = (snap: VehicleSnapshot): Promise<void> =>
  putSnapshot(vehicleKey(snap.vehicleId), snap, 3600);

export const readVehicleSnapshot = (
  vehicleId: string,
): Promise<Snapshot<VehicleSnapshot> | null> => getSnapshot<VehicleSnapshot>(vehicleKey(vehicleId));

/** Test/diagnostic view of the in-process fallback. */
export const memorySnapshotCount = (): number => memory.size;
