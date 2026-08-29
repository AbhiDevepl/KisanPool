import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { LANGUAGES } from '@kisanpool/shared';
import { User } from '../../models';

export const usersRouter = Router();

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw new ApiError('RESOURCE_NOT_FOUND', 'Account not found.');
    ok(res, user);
  }),
);

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  language: z.enum(LANGUAGES).optional(),
  pushToken: z.string().min(1).optional(),
  defaultLocation: z
    .object({ name: z.string(), lat: z.number(), lng: z.number() })
    .optional(),
});

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const updates = patchSchema.parse(req.body);
    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true });
    if (!user) throw new ApiError('RESOURCE_NOT_FOUND', 'Account not found.');
    ok(res, user);
  }),
);
