/**
 * Transporter wallet & withdrawals (ADR-038).
 *
 *   earnings  -> markCaptured() calls creditEarning(), a once-per-payment credit
 *   withdraw  -> requestWithdrawal() debits the wallet, then RazorpayX pays the UPI
 *   outcome   -> the payout webhook (or the create response) settles the row;
 *                a FAILED payout credits the money back
 *
 * Balance only ever moves through an atomic `$inc`, and every move writes one
 * WalletTransaction ledger row.
 */
import { randomUUID } from 'crypto';
import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import { money } from '../../lib/geo';
import {
  TransporterPayoutAccount,
  TransporterWallet,
  User,
  WalletTransaction,
  Withdrawal,
  type WithdrawalDoc,
} from '../../models';
import { notifyPayoutSent } from '../notifications/service';
import { createUpiPayout, mapPayoutStatus, razorpayxEnabled } from './razorpayx';

const UPI_ID = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

async function ensureWallet(userId: string) {
  return TransporterWallet.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, balance: 0, currency: 'INR' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/** Balance plus the most recent ledger rows, newest first. */
export async function getWallet(userId: string) {
  const wallet = await ensureWallet(userId);
  const transactions = await WalletTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50);
  return { balance: wallet.balance, currency: 'INR' as const, transactions };
}

/**
 * Credit a settled load's payout amount into the transporter's wallet. Safe to
 * call twice — the ledger's unique `paymentId` index rejects the second write and
 * we roll the `$inc` back.
 */
export async function creditEarning(
  userId: string,
  paymentId: string,
  amount: number,
): Promise<void> {
  const value = money(amount);
  if (value <= 0) return;

  const already = await WalletTransaction.exists({ paymentId });
  if (already) return;

  const wallet = await TransporterWallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: value }, $setOnInsert: { currency: 'INR' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  try {
    await WalletTransaction.create({
      userId,
      type: 'CREDIT',
      reason: 'EARNING',
      amount: value,
      balanceAfter: wallet.balance,
      paymentId,
    });
  } catch (err) {
    // lost the idempotency race — undo the increment we just made
    await TransporterWallet.updateOne({ userId }, { $inc: { balance: -value } });
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

function serialiseWithdrawal(w: WithdrawalDoc) {
  return {
    _id: String(w._id),
    userId: String(w.userId),
    amount: w.amount,
    upiId: w.upiId,
    status: w.status,
    razorpayPayoutId: w.razorpayPayoutId ?? undefined,
    failureReason: w.failureReason ?? undefined,
    requestedAt: w.get('createdAt'),
    processedAt: w.processedAt ?? undefined,
  };
}

export async function listWithdrawals(userId: string) {
  const rows = await Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(50);
  return rows.map(serialiseWithdrawal);
}

/**
 * Debit `amount` from the wallet and send it to `upiId` through RazorpayX.
 *
 * The debit is a conditioned atomic update, so two concurrent requests can never
 * overdraw. If the payout call fails the debit is reversed and the row is FAILED.
 */
export async function requestWithdrawal(
  userId: string,
  input: { amount: number; upiId: string },
) {
  const amount = Math.floor(Number(input.amount));
  const upiId = String(input.upiId ?? '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError('VALIDATION_ERROR', 'Enter a valid amount to withdraw.');
  }
  if (amount < config.minWithdrawalRupees) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `The minimum withdrawal is ₹${config.minWithdrawalRupees}.`,
    );
  }
  if (!UPI_ID.test(upiId)) {
    throw new ApiError('VALIDATION_ERROR', 'Enter a valid UPI ID, e.g. name@bank.');
  }

  const account = await TransporterPayoutAccount.findOne({ userId });
  if (!account || account.payoutStatus === 'NOT_ONBOARDED') {
    throw new ApiError(
      'PAYOUT_ACCOUNT_INACTIVE',
      'Add your UPI ID in your profile before withdrawing.',
    );
  }

  await ensureWallet(userId);

  // atomic, conditioned debit — null means the balance was not enough
  const debited = await TransporterWallet.findOneAndUpdate(
    { userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true },
  );
  if (!debited) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'That is more than your available wallet balance.',
    );
  }

  const referenceId = `kp_wd_${randomUUID().replace(/-/g, '')}`.slice(0, 40);
  const withdrawal = await Withdrawal.create({
    userId,
    amount,
    upiId,
    status: 'PENDING',
    referenceId,
  });

  await WalletTransaction.create({
    userId,
    type: 'DEBIT',
    reason: 'WITHDRAWAL',
    amount,
    balanceAfter: debited.balance,
    withdrawalId: withdrawal._id,
  });

  try {
    let payoutId: string;
    let payoutStatus: string;

    if (razorpayxEnabled()) {
      const user = await User.findById(userId);
      const result = await createUpiPayout({
        name: user?.name ?? 'KisanPool Transporter',
        upiId,
        amountRupees: amount,
        referenceId,
        notes: { userId, withdrawalId: String(withdrawal._id) },
      });
      payoutId = result.id;
      payoutStatus = result.status;
    } else {
      // demo mode — no RazorpayX credentials; settle immediately
      payoutId = `pout_demo_${withdrawal._id}`;
      payoutStatus = 'processed';
    }

    withdrawal.razorpayPayoutId = payoutId;
    withdrawal.razorpayPayoutStatus = payoutStatus;
    withdrawal.status = mapPayoutStatus(payoutStatus);
    if (withdrawal.status !== 'PENDING') withdrawal.processedAt = new Date();
    await withdrawal.save();

    if (withdrawal.status === 'SUCCESS') {
      await notifyPayoutSent(userId, amount);
    }
    if (withdrawal.status === 'FAILED') {
      await reverseWithdrawal(withdrawal, 'RazorpayX rejected the payout.');
    }
  } catch (err) {
    // the payout call itself failed — give the money back
    await reverseWithdrawal(
      withdrawal,
      err instanceof ApiError ? err.message : 'The payout could not be started.',
    );
    throw err instanceof ApiError
      ? err
      : new ApiError('PAYOUT_TRANSFER_FAILED', 'The withdrawal could not be sent. Try again.');
  }

  return serialiseWithdrawal(withdrawal);
}

/** Credit a failed withdrawal's amount back to the wallet — runs at most once. */
async function reverseWithdrawal(withdrawal: WithdrawalDoc, reason: string): Promise<void> {
  const claimed = await Withdrawal.findOneAndUpdate(
    { _id: withdrawal._id, reversedAt: { $exists: false } },
    { reversedAt: new Date(), status: 'FAILED', failureReason: reason },
    { new: true },
  );
  if (!claimed) return; // already reversed

  const wallet = await TransporterWallet.findOneAndUpdate(
    { userId: withdrawal.userId },
    { $inc: { balance: withdrawal.amount } },
    { new: true, upsert: true },
  );

  await WalletTransaction.create({
    userId: withdrawal.userId,
    type: 'CREDIT',
    reason: 'WITHDRAWAL_REVERSAL',
    amount: withdrawal.amount,
    balanceAfter: wallet.balance,
    withdrawalId: withdrawal._id,
  });

  withdrawal.status = 'FAILED';
  withdrawal.failureReason = reason;
  withdrawal.reversedAt = claimed.reversedAt;
}

/**
 * Settle a withdrawal from a RazorpayX `payout.*` webhook. Idempotent: a payout
 * that is already SUCCESS/FAILED is left alone.
 */
export async function applyPayoutOutcome(
  razorpayPayoutId: string,
  rawStatus: string,
): Promise<void> {
  const withdrawal = await Withdrawal.findOne({ razorpayPayoutId });
  if (!withdrawal || withdrawal.status !== 'PENDING') return;

  const next = mapPayoutStatus(rawStatus);
  withdrawal.razorpayPayoutStatus = rawStatus;

  if (next === 'SUCCESS') {
    withdrawal.status = 'SUCCESS';
    withdrawal.processedAt = new Date();
    await withdrawal.save();
    await notifyPayoutSent(String(withdrawal.userId), withdrawal.amount);
    return;
  }
  if (next === 'FAILED') {
    await reverseWithdrawal(withdrawal, `RazorpayX payout ${rawStatus}.`);
    return;
  }
  await withdrawal.save();
}
