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
        console.warn(
          `[maps] directions returned ${json.status}` +
            (json.error_message ? ` — ${json.error_message}` : '') +
            ' — using straight-line fallback',
        );
        result = fallback(origin, destination);
      } else {
        result = {
          distanceKm: Math.round(((leg.distance?.value ?? 0) / 1000) * 10) / 10,
          durationMinutes: Math.round((leg.duration?.value ?? 0) / 60),
          polyline: json.routes?.[0]?.overview_polyline?.points ?? null,
        };
      }
    } catch (err) {
      console.warn('[maps] directions failed, falling back to straight line', err);
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

// ---------------------------------------------------------------------------
// place search — so a farmer can NAME a pickup instead of being pinned to GPS
// ---------------------------------------------------------------------------

export interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  /** 'google' when geocoded, 'local' when served from the offline gazetteer */
  source: 'google' | 'local';
}

const placeCache = new Map<string, { value: PlaceResult[]; expires: number }>();

/**
 * Resolve a typed place to coordinates. Google Geocoding when a key is set,
 * otherwise the offline gazetteer (`maps/places.ts`) — search must never be dead
 * just because the Maps key is blank, or the farmer with no usable GPS has no way
 * to enter their village at all.
 */
export async function searchPlaces(
  query: string,
  near?: Point | null,
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cacheKey = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
  const hit = placeCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { searchKnownPlaces } = await import('./places');
  const local: PlaceResult[] = searchKnownPlaces(q, near).map((p) => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    source: 'local' as const,
  }));

  let results = local;

  if (config.googleMapsApiKey) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('address', q);
      url.searchParams.set('region', 'in');
      url.searchParams.set('components', 'country:IN');
      if (near) url.searchParams.set('bounds', `${near.lat - 1},${near.lng - 1}|${near.lat + 1},${near.lng + 1}`);
      url.searchParams.set('key', config.googleMapsApiKey);

      const res = await fetch(url);
      const json = (await res.json()) as {
        status: string;
        results?: Array<{
          formatted_address: string;
          geometry?: { location?: { lat: number; lng: number } };
        }>;
      };

      if (json.status === 'OK' && json.results?.length) {
        const geocoded: PlaceResult[] = json.results
          .filter((r) => r.geometry?.location)
          .slice(0, 6)
          .map((r) => ({
            name: r.formatted_address,
            lat: r.geometry!.location!.lat,
            lng: r.geometry!.location!.lng,
            source: 'google' as const,
          }));
        // geocoded first, then any local matches Google missed
        const seen = new Set(geocoded.map((g) => g.name));
        results = [...geocoded, ...local.filter((l) => !seen.has(l.name))];
      } else if (json.status !== 'ZERO_RESULTS') {
        console.warn(`[maps] geocode returned ${json.status} — using local gazetteer`);
      }
    } catch (err) {
      console.warn('[maps] geocode failed, using local gazetteer', err);
    }
  }

  placeCache.set(cacheKey, { value: results, expires: Date.now() + CACHE_TTL_MS });
  return results;
}
