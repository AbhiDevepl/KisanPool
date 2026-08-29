/**
 * A small offline gazetteer for place search when no Google key is configured.
 *
 * The transport pricing engine already degrades to straight-line distance without
 * a Maps key (`maps/service.ts`); place *search* has to degrade too, or the
 * farmer who lives where GPS is flaky — the exact farmer this feature is for —
 * cannot name their village and is forced back onto the device location the bug
 * report is about. This covers the demo corridor (Pune / Nashik / Ahmednagar /
 * Solapur). It is reference data, never used for pricing.
 */
export interface KnownPlace {
  name: string;
  district: string;
  lat: number;
  lng: number;
}

export const KNOWN_PLACES: KnownPlace[] = [
  { name: 'Pimpri, Pune', district: 'Pune', lat: 18.6298, lng: 73.7997 },
  { name: 'Chinchwad, Pune', district: 'Pune', lat: 18.6414, lng: 73.7629 },
  { name: 'Hinjewadi, Pune', district: 'Pune', lat: 18.5913, lng: 73.7389 },
  { name: 'Wagholi, Pune', district: 'Pune', lat: 18.5808, lng: 73.9836 },
  { name: 'Manchar, Pune', district: 'Pune', lat: 19.0038, lng: 73.9403 },
  { name: 'Narayangaon, Pune', district: 'Pune', lat: 19.0742, lng: 73.9375 },
  { name: 'Junnar, Pune', district: 'Pune', lat: 19.2085, lng: 73.8757 },
  { name: 'Rajgurunagar (Khed), Pune', district: 'Pune', lat: 18.8617, lng: 73.8994 },
  { name: 'Shirur, Pune', district: 'Pune', lat: 18.8286, lng: 74.3733 },
  { name: 'Baramati, Pune', district: 'Pune', lat: 18.1514, lng: 74.5772 },
  { name: 'Indapur, Pune', district: 'Pune', lat: 18.1223, lng: 75.0281 },
  { name: 'Daund, Pune', district: 'Pune', lat: 18.4647, lng: 74.5815 },
  { name: 'Saswad, Pune', district: 'Pune', lat: 18.3462, lng: 74.0316 },
  { name: 'Lasalgaon, Nashik', district: 'Nashik', lat: 20.1417, lng: 74.2389 },
  { name: 'Niphad, Nashik', district: 'Nashik', lat: 20.0805, lng: 74.1099 },
  { name: 'Pimpalgaon Baswant, Nashik', district: 'Nashik', lat: 20.1699, lng: 74.0966 },
  { name: 'Nashik Road', district: 'Nashik', lat: 19.9975, lng: 73.7898 },
  { name: 'Sinnar, Nashik', district: 'Nashik', lat: 19.8489, lng: 74.0006 },
  { name: 'Yeola, Nashik', district: 'Nashik', lat: 20.0417, lng: 74.4894 },
  { name: 'Manmad, Nashik', district: 'Nashik', lat: 20.2515, lng: 74.4383 },
  { name: 'Chandwad, Nashik', district: 'Nashik', lat: 20.3306, lng: 74.2447 },
  { name: 'Sangamner, Ahmednagar', district: 'Ahmednagar', lat: 19.5726, lng: 74.2119 },
  { name: 'Rahata, Ahmednagar', district: 'Ahmednagar', lat: 19.7107, lng: 74.4844 },
  { name: 'Shrirampur, Ahmednagar', district: 'Ahmednagar', lat: 19.6186, lng: 74.6603 },
  { name: 'Rahuri, Ahmednagar', district: 'Ahmednagar', lat: 19.3906, lng: 74.6493 },
  { name: 'Ahmednagar', district: 'Ahmednagar', lat: 19.0948, lng: 74.748 },
  { name: 'Parner, Ahmednagar', district: 'Ahmednagar', lat: 19.0056, lng: 74.4372 },
  { name: 'Shevgaon, Ahmednagar', district: 'Ahmednagar', lat: 19.3597, lng: 75.2325 },
  { name: 'Karjat, Ahmednagar', district: 'Ahmednagar', lat: 18.9124, lng: 75.0111 },
  { name: 'Solapur', district: 'Solapur', lat: 17.6599, lng: 75.9064 },
  { name: 'Pandharpur, Solapur', district: 'Solapur', lat: 17.6792, lng: 75.3305 },
  { name: 'Barshi, Solapur', district: 'Solapur', lat: 18.2337, lng: 75.6903 },
  { name: 'Akluj, Solapur', district: 'Solapur', lat: 17.8828, lng: 75.0198 },
  { name: 'Malshiras, Solapur', district: 'Solapur', lat: 17.8592, lng: 74.9331 },
];

/** Case/space-insensitive substring match, nearest-first when an anchor is given. */
export function searchKnownPlaces(
  query: string,
  near?: { lat: number; lng: number } | null,
  limit = 6,
): KnownPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = KNOWN_PLACES.filter(
    (p) => p.name.toLowerCase().includes(q) || p.district.toLowerCase().includes(q),
  );
  if (near) {
    hits.sort(
      (a, b) =>
        (a.lat - near.lat) ** 2 + (a.lng - near.lng) ** 2 -
        ((b.lat - near.lat) ** 2 + (b.lng - near.lng) ** 2),
    );
  }
  return hits.slice(0, limit);
}
