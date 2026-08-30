/**
 * Mandis (ADR-039).
 *
 *   mandisRouter       GET /mandis            — farmer's nearby list ($near)
 *                      GET /mandis/:id        — one mandi
 *   adminMandisRouter  GET  /admin/mandis     — every mandi (console list)
 *                      POST /admin/mandis     — create one, or many via { mandis: [...] }
 *                      PATCH /admin/mandis/:id — toggle active / edit
 *                      DELETE /admin/mandis/:id
 */
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireAdmin, type AuthedRequest } from '../../middleware/auth';
import { Mandi, type MandiDoc } from '../../models';
import { estimateEtaMinutes } from '../maps/service';

const coordsOf = (m: MandiDoc): [number, number] => {
  const c = m.geo?.coordinates ?? [];
  return [Number(c[0] ?? 0), Number(c[1] ?? 0)]; // [lng, lat]
};

const serialise = (m: MandiDoc, extra?: { distanceKm?: number; etaMinutes?: number }) => {
  const [lng, lat] = coordsOf(m);
  return {
    _id: String(m._id),
    name: m.name,
    city: m.city,
    state: m.state,
    crops: m.crops ?? [],
    active: m.active,
    location: { name: m.name, lat, lng },
    createdAt: m.get('createdAt'),
    ...(extra?.distanceKm != null
      ? { distanceKm: Math.round(extra.distanceKm * 10) / 10 }
      : {}),
    ...(extra?.etaMinutes != null ? { etaMinutes: extra.etaMinutes } : {}),
  };
};

const mandiInput = z.object({
  name: z.string().min(2).max(120),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  crops: z.array(z.string().min(1)).max(30).optional(),
});

// ---------------------------------------------------------------- farmer-facing

export const mandisRouter = Router();
mandisRouter.use(requireAuth);

/**
 * Only mandis an operator has created and left active. With `lat`/`lng` the list
 * is limited to `radiusKm` (default 150) and sorted nearest-first.
 */
mandisRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const q = z
      .object({
        lat: z.coerce.number().optional(),
        lng: z.coerce.number().optional(),
        radiusKm: z.coerce.number().min(1).max(2000).default(150),
      })
      .parse(req.query);

    if (q.lat == null || q.lng == null) {
      const all = await Mandi.find({ active: true }).sort({ name: 1 }).limit(200);
      ok(res, { mandis: all.map((m) => serialise(m)) });
      return;
    }

    const near = await Mandi.find({
      active: true,
      geo: {
        $near: {
          $geometry: { type: 'Point', coordinates: [q.lng, q.lat] },
          $maxDistance: q.radiusKm * 1000,
        },
      },
    }).limit(200);

    const haversine = (lat: number, lng: number): number => {
      const R = 6371;
      const dLat = ((lat - q.lat!) * Math.PI) / 180;
      const dLng = ((lng - q.lng!) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((q.lat! * Math.PI) / 180) *
          Math.cos((lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    const origin = { lat: q.lat, lng: q.lng };
    const withEta = await Promise.all(
      near.map(async (m, i) => {
        const [lng, lat] = coordsOf(m);
        const distanceKm = haversine(lat, lng);
        // real road ETA for the closest few; a rough estimate for the rest so one
        // request never fans out into dozens of directions calls
        const etaMinutes =
          i < 12
            ? await estimateEtaMinutes(origin, { lat, lng }).catch(() =>
                Math.round((distanceKm / 35) * 60),
              )
            : Math.round((distanceKm / 35) * 60);
        return serialise(m, { distanceKm, etaMinutes });
      }),
    );

    ok(res, { mandis: withEta });
  }),
);

mandisRouter.get(
  '/:id',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const mandi = await Mandi.findById(req.params.id);
    if (!mandi || !mandi.active) {
      throw new ApiError('RESOURCE_NOT_FOUND', 'That mandi could not be found.');
    }
    ok(res, serialise(mandi));
  }),
);

// ----------------------------------------------------------------------- admin

export const adminMandisRouter = Router();
adminMandisRouter.use(requireAdmin);

adminMandisRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const all = await Mandi.find({}).sort({ createdAt: -1 });
    ok(res, { mandis: all.map((m) => serialise(m)) });
  }),
);

/** Create one mandi, or a batch with `{ mandis: [...] }`. */
adminMandisRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const batch = z.object({ mandis: z.array(mandiInput).min(1).max(100) }).safeParse(req.body);
    const inputs = batch.success ? batch.data.mandis : [mandiInput.parse(req.body)];

    const docs = await Mandi.insertMany(
      inputs.map((i) => ({
        name: i.name,
        city: i.city,
        state: i.state,
        crops: i.crops ?? [],
        active: true,
        geo: { type: 'Point', coordinates: [i.lng, i.lat] },
      })),
    );

    ok(res, { mandis: docs.map((m) => serialise(m as MandiDoc)) }, 201);
  }),
);

adminMandisRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        name: z.string().min(2).max(120).optional(),
        city: z.string().min(1).max(80).optional(),
        state: z.string().min(1).max(80).optional(),
        crops: z.array(z.string().min(1)).max(30).optional(),
        active: z.boolean().optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .parse(req.body);

    const mandi = await Mandi.findById(req.params.id);
    if (!mandi) throw new ApiError('RESOURCE_NOT_FOUND', 'That mandi could not be found.');

    if (patch.name != null) mandi.name = patch.name;
    if (patch.city != null) mandi.city = patch.city;
    if (patch.state != null) mandi.state = patch.state;
    if (patch.crops != null) mandi.crops = patch.crops;
    if (patch.active != null) mandi.active = patch.active;
    if (patch.lat != null && patch.lng != null) {
      mandi.geo = { type: 'Point', coordinates: [patch.lng, patch.lat] };
    }
    await mandi.save();
    ok(res, serialise(mandi));
  }),
);

adminMandisRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await Mandi.findByIdAndDelete(req.params.id);
    if (!deleted) throw new ApiError('RESOURCE_NOT_FOUND', 'That mandi could not be found.');
    ok(res, { deleted: true });
  }),
);
