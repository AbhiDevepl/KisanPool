import { OCCUPIES_SCHEDULE, type DemandClusterDTO, type MachineCategory } from '@kisanpool/shared';
import { haversineKm, type Point } from '../../lib/geo';
import { MachineBooking } from '../../models';

const asPoint = (p: { lat?: number | null; lng?: number | null }): Point => ({
  lat: p.lat as number,
  lng: p.lng as number,
});

// ---------------------------------------------------------------------------
// demand aggregation — the utilisation story, without a prediction model
// ---------------------------------------------------------------------------

/**
 * How close two jobs have to be to count as the same pocket of demand.
 *
 * Distance-based, NOT a lat/lng grid. A grid is one line of code shorter and
 * quietly wrong: Chinchwad and Hinjewadi are 6 km apart and land in different
 * cells at any usable cell size, so the two farmers who most obviously form a
 * cluster were reported as two singletons and filtered out. Real distance has no
 * such seams.
 */
const CLUSTER_RADIUS_KM = 15;

/**
 * Where nearby farmers want the same thing at the same time.
 *
 * The cheapest honest form of demand aggregation: bucket open requests by
 * category and a coarse lat/lng grid, and count them. No model, no prediction, no
 * training data — just "four farmers within about 10 km of you want a harvester
 * this week", which is exactly the fact that makes it worth a provider's while to
 * come out, and exactly the fact neither side can see today.
 */
export async function demandClusters(
  near: Point,
  radiusKm = 40,
  days = 14,
): Promise<DemandClusterDTO[]> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);

  // sorted so the greedy pass below is deterministic: the same bookings always
  // produce the same clusters, whoever asks and whenever
  const requests = await MachineBooking.find({
    state: { $in: OCCUPIES_SCHEDULE },
    'window.start': { $gte: now, $lte: until },
  })
    .sort({ category: 1, 'window.start': 1, _id: 1 })
    .limit(500);

  interface Bucket extends Omit<DemandClusterDTO, 'farmerCount'> {
    farmers: Set<string>;
    n: number;
  }
  const buckets: Bucket[] = [];

  for (const booking of requests) {
    const site = asPoint(booking.location);
    if (haversineKm(near, site) > radiusKm) continue;

    // join the nearest existing pocket of the same category, if one is close enough
    const match = buckets.find(
      (b) => b.category === booking.category && haversineKm(b.centre, site) <= CLUSTER_RADIUS_KM,
    );

    if (!match) {
      buckets.push({
        category: booking.category as MachineCategory,
        centre: site,
        placeName: booking.location.name || 'Nearby',
        totalAcres: booking.areaAcres ?? 0,
        from: booking.window.start.toISOString(),
        to: booking.window.end.toISOString(),
        farmers: new Set([String(booking.farmerId)]),
        n: 1,
      });
      continue;
    }

    // running mean keeps the centre honest as the pocket fills
    match.n += 1;
    match.centre = {
      lat: match.centre.lat + (site.lat - match.centre.lat) / match.n,
      lng: match.centre.lng + (site.lng - match.centre.lng) / match.n,
    };
    match.totalAcres += booking.areaAcres ?? 0;
    // distinct FARMERS, not bookings — one farmer booking twice is not demand from two
    match.farmers.add(String(booking.farmerId));
    if (booking.window.start.toISOString() < match.from) {
      match.from = booking.window.start.toISOString();
    }
    if (booking.window.end.toISOString() > match.to) {
      match.to = booking.window.end.toISOString();
    }
  }

  return buckets
    .map(({ farmers, n: _n, ...rest }) => ({ ...rest, farmerCount: farmers.size }))
    .filter((cluster) => cluster.farmerCount > 1) // one farmer is not a cluster
    .sort((a, b) => b.farmerCount - a.farmerCount)
    .slice(0, 10);
}
