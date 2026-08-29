const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export interface Point {
  lat: number;
  lng: number;
}

/** Straight-line distance — used for match scoring; road distance comes from the Directions proxy. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Rupees, rounded to 2dp — money is never carried as a raw float through the API. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
