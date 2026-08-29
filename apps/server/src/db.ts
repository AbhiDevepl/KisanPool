import mongoose from 'mongoose';
import { config } from './config';

/**
 * Connect with the durability and retry behaviour an HA replica set is for
 * (ADR-044).
 *
 * These were previously all left to defaults. The defaults happen to be right on
 * Atlas, but "happens to be right" is not a guarantee — an explicit setting is
 * what makes the intent survive a connection-string change or a move to a
 * different cluster:
 *
 *   w: 'majority'     an acknowledged write is on a majority of members, so it
 *                     survives the primary dying. Without it a write can be
 *                     acknowledged and then lost in the very failover this whole
 *                     layer is meant to ride out.
 *   retryWrites       the driver retries a write once against the new primary
 *                     after an election, which is what turns a ~10s failover into
 *                     something the application never sees.
 *   retryReads        same, for reads.
 *   serverSelection   fail fast enough to detect an incident, slow enough not to
 *                     trip over a normal election.
 */
export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.mongoUri, {
    writeConcern: { w: 'majority' },
    retryWrites: true,
    retryReads: true,
    serverSelectionTimeoutMS: 8000,
    heartbeatFrequencyMS: 10_000,
  });

  // the driver reconnects on its own; these are for visibility during an incident
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));

  console.log('[db] connected (w:majority, retryable reads/writes)');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Transactions need a replica set. Atlas gives us one; a bare local mongod does not,
 * so the booking commit falls back to its conditioned findOneAndUpdate alone — which
 * is what actually guarantees single-booking (docs/ARCHITECTURE.md §3 step 10).
 */
export async function supportsTransactions(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const info = await admin.command({ hello: 1 });
    return Boolean(info.setName || info.msg === 'isdbgrid');
  } catch {
    return false;
  }
}
