import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { upload } from '../../lib/upload';
import { LANGUAGES } from '@kisanpool/shared';
import { User } from '../../models';
import { speechToText, textToSpeech } from './sarvam';
import { chat } from './service';

export const aiRouter = Router();

aiRouter.post(
  '/stt',
  requireAuth,
  upload.single('audio'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!req.file) throw new ApiError('VALIDATION_ERROR', 'audio: a recording is required');
    ok(res, await speechToText(req.file));
  }),
);

aiRouter.post(
  '/tts',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { text, language } = z
      .object({ text: z.string().min(1).max(1000), language: z.enum(LANGUAGES) })
      .parse(req.body);
    ok(res, { audio: await textToSpeech(text, language) });
  }),
);

aiRouter.post(
  '/chat',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        message: z.string().min(1).max(1000),
        sessionId: z.string().min(1),
        language: z.enum(LANGUAGES).optional(),
      })
      .parse(req.body);

    const user = await User.findById(req.userId);
    ok(
      res,
      await chat({
        userId: req.userId,
        sessionId: body.sessionId,
        message: body.message,
        language: body.language ?? (user?.language as 'mr' | 'hi' | 'en') ?? 'en',
      }),
    );
  }),
);
