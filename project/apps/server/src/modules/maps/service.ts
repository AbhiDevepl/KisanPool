import { config } from '../../config';
import { haversineKm, type Point } from '../../lib/geo';

interface DirectionsResult {
  distanceKm: number;
  durationMinutes: number;
  polyline: string | null;
}

/** Cached per origin→destination pair so a live trip doesn't re-bill on every GPS tick. */
const cache = new Map<string, { value: DirectionsResult; expires: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const AVERAGE_SPEED_KMH = 35; // fallback when no Maps key is configured

const key = (o: Point, d: Point): string =>
  `${o.lat.toFixed(4)},${o.lng.toFixed(4)}->${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;

/**
 * Falls back to straight-line distance when no key is set or Google is unreachable.
 * A trip must never be blocked on the map layer (docs/API_CONTRACTS.md §5).
 */
function fallback(origin: Point, destination: Point): DirectionsResult {
  const distanceKm = haversineKm(origin, destination) * 1.3; // rough road factor
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes: Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60),
    polyline: null,
  };
}

export async function getDirections(origin: Point, destination: Point): Promise<DirectionsResult> {
  const cacheKey = key(origin, destination);
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  let result: DirectionsResult;

  if (!config.googleMapsApiKey) {
    result = fallback(origin, destination);
  } else {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
      url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
      url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
      url.searchParams.set('key', config.googleMapsApiKey);

      const res = await fetch(url);
      const json = (await res.json()) as {
        status: string;
        error_message?: string;
        routes?: Array<{
          overview_polyline?: { points: string };
          legs?: Array<{ distance?: { value: number }; duration?: { value: number } }>;
        }>;
      };

      const leg = json.routes?.[0]?.legs?.[0];
      if (json.status !== 'OK' || !leg) {
        // console.warn(
        //   `[maps] directions returned ${json.status}` +
        //     (json.error_message ? ` — ${json.error_message}` : '') +
        //     ' — using straight-line fallback',
        // );
        result = fallback(origin, destination);
      } else {
        result = {
          distanceKm: Math.round(((leg.distance?.value ?? 0) / 1000) * 10) / 10,
          durationMinutes: Math.round((leg.duration?.value ?? 0) / 60),
          polyline: json.routes?.[0]?.overview_polyline?.points ?? null,
        };
      }
    } catch (err) {
      // console.warn('[maps] directions failed, falling back to straight line', err);
      result = fallback(origin, destination);
    }
  }

  cache.set(cacheKey, { value: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function estimateEtaMinutes(from: Point, to: Point): Promise<number> {
  const { durationMinutes } = await getDirections(from, to);
  return durationMinutes;
}
