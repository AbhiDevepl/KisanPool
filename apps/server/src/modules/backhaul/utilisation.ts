import { type TripUtilisationDTO } from '@kisanpool/shared';
import { money } from '../../lib/geo';
import { BackhaulBooking, Trip } from '../../models';
import { priceTripById } from '../pooling/pricing';

// ---------------------------------------------------------------------------
// the round trip, in one object
// ---------------------------------------------------------------------------

/**
 * Both directions of one journey — the number that makes the whole feature make
 * sense to a driver. Outbound comes from the V1 pricing engine unchanged; the
 * return comes from its bookings. Neither is recomputed here.
 */
export async function tripUtilisation(tripId: string): Promise<TripUtilisationDTO | null> {
  const trip = await Trip.findById(tripId);
  if (!trip) return null;

  const outbound = await priceTripById(tripId);
  const returns = await BackhaulBooking.find({
    tripId: trip._id,
    state: { $ne: 'CANCELLED' },
  });

  const outboundKm = outbound?.effectiveRouteKm ?? trip.routeDistanceKm ?? 0;
  const emptyReturnKm = trip.returnLeg?.emptyReturnKm ?? 0;
  const returnKm = returns.length ? emptyReturnKm + (trip.returnLeg?.routeKm ?? 0) : emptyReturnKm;

  const outboundLoadKg = outbound?.totalQuantityKg ?? 0;
  const returnLoadKg = returns.reduce((sum, b) => sum + b.weightKg, 0);
  const returnEarning = money(returns.reduce((sum, b) => sum + b.transporterEarning, 0));

  /*
   * How much of the homeward run was actually loaded.
   *
   * The LONGEST-riding load, not the sum of them. Two return loads travelling the
   * same stretch of road are one loaded stretch, and adding their distances
   * together counts that road twice — which pushed utilisation to a suspiciously
   * tidy 100% on any leg carrying two loads. The longest ride is the honest
   * measure of how far the vehicle went with something aboard, and it can never
   * exceed the leg itself.
   */
  const returnLoadedKm = returns.reduce((longest, b) => Math.max(longest, b.carryKm), 0);

  const totalKm = money(outboundKm + returnKm);
  const loadedKm = money(outboundKm + Math.min(returnLoadedKm, returnKm));

  return {
    outboundKm: money(outboundKm),
    returnKm: money(returnKm),
    totalKm,
    outboundEarning: outbound?.transporterEarning ?? 0,
    returnEarning,
    totalEarning: money((outbound?.transporterEarning ?? 0) + returnEarning),
    outboundLoadKg,
    returnLoadKg,
    capacityKg: trip.totalCapacityKg,
    utilisationPct: totalKm > 0 ? Math.round(Math.min(1, loadedKm / totalKm) * 100) : 0,
    emptyKmRecovered: money(Math.min(returnLoadedKm, emptyReturnKm)),
  };
}
