import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth } from '../../middleware/auth';
import { getDirections } from './service';

const pointSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'must be "lat,lng"')
  .transform((value) => {
    const [lat, lng] = value.split(',').map(Number);
    return { lat, lng };
  });

const querySchema = z.object({ origin: pointSchema, destination: pointSchema });

export const mapsRouter = Router();

mapsRouter.get(
  '/directions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { origin, destination } = querySchema.parse(req.query);
    ok(res, await getDirections(origin, destination));
  }),
);
