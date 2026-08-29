/**
 * A small reference list of Maharashtra mandis for discovery. Prices are
 * indicative bands shown as guidance, not quotes — nothing here feeds pricing,
 * which is computed server-side from distance and the vehicle's rate.
 */
export interface Mandi {
  id: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  crops: string[];
  hours: string;
  prices: Array<{ crop: string; min: number; max: number }>;
}

export const MANDIS: Mandi[] = [
  {
    id: 'lasalgaon',
    name: 'Lasalgaon Mandi',
    district: 'Nashik',
    lat: 20.1417,
    lng: 74.2389,
    crops: ['Onion', 'Grapes'],
    hours: '6:00 AM – 6:00 PM',
    prices: [
      { crop: 'Onion', min: 1200, max: 1850 },
      { crop: 'Grapes', min: 3500, max: 5200 },
    ],
  },
  {
    id: 'pune-market-yard',
    name: 'Pune Market Yard',
    district: 'Pune',
    lat: 18.4805,
    lng: 73.8683,
    crops: ['Tomato', 'Potato', 'Onion'],
    hours: '5:00 AM – 8:00 PM',
    prices: [
      { crop: 'Tomato', min: 900, max: 1600 },
      { crop: 'Potato', min: 1100, max: 1750 },
      { crop: 'Onion', min: 1250, max: 1900 },
    ],
  },
  {
    id: 'vashi-apmc',
    name: 'Vashi APMC',
    district: 'Navi Mumbai',
    lat: 19.0662,
    lng: 73.0021,
    crops: ['Onion', 'Tomato', 'Potato'],
    hours: '4:00 AM – 7:00 PM',
    prices: [
      { crop: 'Onion', min: 1400, max: 2100 },
      { crop: 'Tomato', min: 1000, max: 1800 },
    ],
  },
  {
    id: 'ahmednagar',
    name: 'Ahmednagar Mandi',
    district: 'Ahmednagar',
    lat: 19.0948,
    lng: 74.7480,
    crops: ['Onion', 'Potato'],
    hours: '6:00 AM – 5:00 PM',
    prices: [
      { crop: 'Onion', min: 1150, max: 1700 },
      { crop: 'Potato', min: 1050, max: 1600 },
    ],
  },
  {
    id: 'solapur',
    name: 'Solapur Mandi',
    district: 'Solapur',
    lat: 17.6599,
    lng: 75.9064,
    crops: ['Grapes', 'Onion'],
    hours: '6:00 AM – 6:00 PM',
    prices: [
      { crop: 'Grapes', min: 3200, max: 4800 },
      { crop: 'Onion', min: 1100, max: 1650 },
    ],
  },
];

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function distanceFrom(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
): number {
  const dLat = toRad(target.lat - origin.lat);
  const dLng = toRad(target.lng - origin.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(origin.lat)) * Math.cos(toRad(target.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
