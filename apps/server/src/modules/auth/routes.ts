import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { ROLES } from '@kisanpool/shared';
import { refresh, requestOtp, verifyOtp } from './service';

const phone = z.string().regex(/^[6-9]\d{9}$/, 'must be a 10-digit Indian mobile number');

export const authRouter = Router();

authRouter.post(
  '/request-otp',
  asyncHandler(async (req, res) => {
    const body = z.object({ phone, role: z.enum(ROLES).default('FARMER') }).parse(req.body);
    ok(res, await requestOtp(body.phone, body.role));
  }),
);

authRouter.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const body = z.object({ phone, code: z.string().length(6) }).parse(req.body);
    ok(res, await verifyOtp(body.phone, body.code));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    ok(res, await refresh(body.refreshToken));
  }),
);
