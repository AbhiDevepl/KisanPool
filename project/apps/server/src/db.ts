import mongoose from 'mongoose';
import { config } from './config';

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log('[db] connected');
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
