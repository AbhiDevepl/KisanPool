import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth } from '../../middleware/auth';
import { getDirections, searchPlaces } from './service';

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

/**
 * Resolve a typed place name to coordinates so a farmer can NAME a pickup rather
 * than being pinned to device GPS. Degrades to an offline gazetteer with no
 * Maps key (`maps/places.ts`).
 */
const placesSchema = z.object({
  q: z.string().min(2).max(120),
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .transform((v) => {
      const [lat, lng] = v.split(',').map(Number);
      return { lat, lng };
    })
    .optional(),
});

mapsRouter.get(
  '/places',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { q, near } = placesSchema.parse(req.query);
    ok(res, await searchPlaces(q, near ?? null));
  }),
);
