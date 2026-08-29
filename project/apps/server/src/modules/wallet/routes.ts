import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { getWallet, listWithdrawals, requestWithdrawal } from './service';

export const walletRouter = Router();

walletRouter.use(requireAuth, requireRole('TRANSPORTER'));

/** Balance + recent ledger. */
walletRouter.get(
  '/me',
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await getWallet(req.userId));
  }),
);

walletRouter.get(
  '/withdrawals',
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, { withdrawals: await listWithdrawals(req.userId) });
  }),
);

/** Withdraw wallet money to a UPI ID via RazorpayX. */
walletRouter.post(
  '/withdraw',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({ amount: z.number().positive(), upiId: z.string().min(3).max(256) })
      .parse(req.body);
    ok(res, await requestWithdrawal(req.userId, body), 201);
  }),
);
