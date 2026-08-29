/**
 * The mandi reference layer.
 *
 * Maharashtra APMC markets with indicative price bands. This is demo/reference
 * data, deliberately kept in ONE place rather than scattered through the mandi
 * screens as literals — the discovery and detail screens read every number they
 * render from here, so there is exactly one story to keep consistent.
 *
 * Nothing here feeds pricing. A trip's cost is computed server-side from distance
 * and the vehicle's rate; these bands are market guidance for choosing a mandi.
 */

export type Category = 'Vegetables' | 'Fruits' | 'Grains' | 'Flowers';
export type Demand = 'HIGH' | 'MEDIUM' | 'LOW';
export type Trend = 'UP' | 'FLAT' | 'DOWN';

export interface CommodityPrice {
  crop: string;
  min: number;
  max: number;
  /** the price most lots actually clear at — what a farmer plans against */
  modal: number;
  trend: Trend;
}

export interface Mandi {
  id: string;
  name: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
  categories: Category[];
  crops: string[];
  hours: string;
  /** minutes past midnight, used to decide "Open now" without hardcoding a string */
  opensAt: number;
  closesAt: number;
  demand: Demand;
  establishedYear: number;
  areaAcres: number;
  registeredFarmers: number;
  prices: CommodityPrice[];
}

export const MANDIS: Mandi[] = [
  {
    id: 'lasalgaon',
    name: 'Lasalgaon Mandi',
    district: 'Nashik',
    state: 'Maharashtra',
    lat: 20.1417,
    lng: 74.2389,
    categories: ['Vegetables'],
    crops: ['Onion', 'Grapes', 'Tomato'],
    hours: '6:00 AM – 6:00 PM',
    opensAt: 6 * 60,
    closesAt: 18 * 60,
    demand: 'HIGH',
    establishedYear: 1975,
    areaAcres: 25,
    registeredFarmers: 2500,
    prices: [
      { crop: 'Onion', min: 1400, max: 2100, modal: 1860, trend: 'UP' },
      { crop: 'Tomato', min: 900, max: 1600, modal: 1250, trend: 'UP' },
      { crop: 'Grapes', min: 3500, max: 5200, modal: 4300, trend: 'FLAT' },
    ],
  },
  {
    id: 'pune-market-yard',
    name: 'Pune Market Yard',
    district: 'Pune',
    state: 'Maharashtra',
    lat: 18.4805,
    lng: 73.8683,
    // the yard runs a flower section alongside the produce halls, so Flowers is
    // added to the record that already exists rather than duplicating the mandi
    categories: ['Vegetables', 'Fruits', 'Flowers'],
    crops: ['Tomato', 'Potato', 'Onion', 'Marigold'],
    hours: '5:00 AM – 8:00 PM',
    opensAt: 5 * 60,
    closesAt: 20 * 60,
    demand: 'MEDIUM',
    establishedYear: 1982,
    areaAcres: 42,
    registeredFarmers: 4100,
    prices: [
      { crop: 'Tomato', min: 900, max: 1600, modal: 1310, trend: 'UP' },
      { crop: 'Potato', min: 1100, max: 1750, modal: 1450, trend: 'FLAT' },
      { crop: 'Onion', min: 1250, max: 1900, modal: 1720, trend: 'UP' },
      { crop: 'Marigold', min: 2600, max: 4800, modal: 3800, trend: 'UP' },
    ],
  },
  {
    id: 'vashi-apmc',
    name: 'Vashi APMC',
    district: 'Navi Mumbai',
    state: 'Maharashtra',
    lat: 19.0662,
    lng: 73.0021,
    categories: ['Vegetables', 'Fruits'],
    crops: ['Onion', 'Tomato', 'Potato'],
    hours: '4:00 AM – 7:00 PM',
    opensAt: 4 * 60,
    closesAt: 19 * 60,
    demand: 'HIGH',
    establishedYear: 1996,
    areaAcres: 68,
    registeredFarmers: 6800,
    prices: [
      { crop: 'Onion', min: 1400, max: 2100, modal: 1950, trend: 'UP' },
      { crop: 'Tomato', min: 1000, max: 1800, modal: 1480, trend: 'UP' },
      { crop: 'Potato', min: 1150, max: 1820, modal: 1520, trend: 'FLAT' },
    ],
  },
  {
    id: 'ahmednagar',
    name: 'Ahmednagar Mandi',
    district: 'Ahmednagar',
    state: 'Maharashtra',
    lat: 19.0948,
    lng: 74.748,
    categories: ['Vegetables', 'Grains'],
    crops: ['Onion', 'Potato'],
    hours: '6:00 AM – 5:00 PM',
    opensAt: 6 * 60,
    closesAt: 17 * 60,
    demand: 'MEDIUM',
    establishedYear: 1969,
    areaAcres: 18,
    registeredFarmers: 1900,
    prices: [
      { crop: 'Onion', min: 1150, max: 1700, modal: 1420, trend: 'DOWN' },
      { crop: 'Potato', min: 1050, max: 1600, modal: 1330, trend: 'FLAT' },
    ],
  },
  {
    id: 'solapur',
    name: 'Solapur Mandi',
    district: 'Solapur',
    state: 'Maharashtra',
    lat: 17.6599,
    lng: 75.9064,
    categories: ['Fruits', 'Grains'],
    crops: ['Grapes', 'Onion'],
    hours: '6:00 AM – 6:00 PM',
    opensAt: 6 * 60,
    closesAt: 18 * 60,
    demand: 'LOW',
    establishedYear: 1971,
    areaAcres: 21,
    registeredFarmers: 1600,
    prices: [
      { crop: 'Grapes', min: 3200, max: 4800, modal: 3950, trend: 'FLAT' },
      { crop: 'Onion', min: 1100, max: 1650, modal: 1380, trend: 'DOWN' },
    ],
  },
  {
    id: 'dadar-phool',
    name: 'Dadar Phool Market',
    district: 'Mumbai',
    state: 'Maharashtra',
    lat: 19.0184,
    lng: 72.844,
    categories: ['Flowers'],
    crops: ['Marigold', 'Rose', 'Jasmine', 'Tuberose'],
    // flower markets trade before dawn and are finished by midday — the produce
    // has to reach shops and temples the same morning
    hours: '4:00 AM – 12:00 PM',
    opensAt: 4 * 60,
    closesAt: 12 * 60,
    demand: 'HIGH',
    establishedYear: 1963,
    areaAcres: 8,
    registeredFarmers: 3200,
    prices: [
      { crop: 'Marigold', min: 2800, max: 5200, modal: 4100, trend: 'UP' },
      { crop: 'Rose', min: 7500, max: 14000, modal: 10500, trend: 'UP' },
      { crop: 'Jasmine', min: 18000, max: 34000, modal: 26000, trend: 'FLAT' },
      { crop: 'Tuberose', min: 4500, max: 8000, modal: 6200, trend: 'FLAT' },
    ],
  },
  {
    id: 'nashik-flower',
    name: 'Nashik Flower Market',
    district: 'Nashik',
    state: 'Maharashtra',
    lat: 19.9975,
    lng: 73.7898,
    categories: ['Flowers', 'Vegetables'],
    crops: ['Marigold', 'Chrysanthemum', 'Gerbera', 'Tomato'],
    hours: '5:00 AM – 2:00 PM',
    opensAt: 5 * 60,
    closesAt: 14 * 60,
    demand: 'MEDIUM',
    establishedYear: 1994,
    areaAcres: 11,
    registeredFarmers: 1400,
    prices: [
      { crop: 'Marigold', min: 2400, max: 4600, modal: 3500, trend: 'FLAT' },
      { crop: 'Chrysanthemum', min: 3200, max: 6000, modal: 4600, trend: 'UP' },
      { crop: 'Gerbera', min: 9000, max: 16000, modal: 12500, trend: 'UP' },
      { crop: 'Tomato', min: 950, max: 1550, modal: 1220, trend: 'FLAT' },
    ],
  },
  {
    id: 'daund',
    name: 'Daund Mandi',
    district: 'Pune',
    state: 'Maharashtra',
    lat: 18.4646,
    lng: 74.5815,
    categories: ['Grains', 'Vegetables'],
    crops: ['Onion', 'Pulses', 'Jowar'],
    hours: '6:30 AM – 5:30 PM',
    opensAt: 390,
    closesAt: 17 * 60 + 30,
    demand: 'MEDIUM',
    establishedYear: 1988,
    areaAcres: 14,
    registeredFarmers: 1200,
    prices: [
      { crop: 'Onion', min: 1120, max: 1680, modal: 1400, trend: 'FLAT' },
      { crop: 'Pulses', min: 4800, max: 6400, modal: 5600, trend: 'UP' },
    ],
  },
];

export const CATEGORIES: Array<'All' | Category> = [
  'All',
  'Vegetables',
  'Fruits',
  'Grains',
  'Flowers',
];

export const findMandi = (id?: string | null): Mandi | undefined =>
  MANDIS.find((mandi) => mandi.id === id);

// ---------------------------------------------------------------------------
// geo
// ---------------------------------------------------------------------------

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

/** Rough road time at a rural-highway average — good enough to compare two mandis. */
const AVERAGE_SPEED_KMPH = 38;

export const travelMinutes = (distanceKm: number): number =>
  Math.max(5, Math.round((distanceKm / AVERAGE_SPEED_KMPH) * 60));

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function isOpenNow(mandi: Mandi, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= mandi.opensAt && minutes < mandi.closesAt;
}

export function closingLabel(mandi: Mandi): string {
  const hour = Math.floor(mandi.closesAt / 60);
  const minute = mandi.closesAt % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** The headline rate a discovery card shows — the best modal price on offer. */
export const topModalPrice = (mandi: Mandi): CommodityPrice =>
  mandi.prices.reduce((best, price) => (price.modal > best.modal ? price : best), mandi.prices[0]);

export const DEMAND_LABEL: Record<Demand, string> = {
  HIGH: 'High demand',
  MEDIUM: 'Medium demand',
  LOW: 'Low demand',
};

export interface RankedMandi extends Mandi {
  distanceKm: number;
  etaMinutes: number;
  favourite: boolean;
  /** 0–100; distance and demand together, so the top card is a real recommendation */
  score: number;
}

/**
 * Rank mandis for one farmer. Closeness dominates because transport is the cost
 * being optimised; demand breaks ties. Favourites float to the top of equal scores.
 */
export function rankMandis(
  origin: { lat: number; lng: number } | null,
  favourites: string[],
  filters: { category?: 'All' | Category; query?: string } = {},
): RankedMandi[] {
  const { category = 'All', query = '' } = filters;
  const needle = query.trim().toLowerCase();

  const demandScore: Record<Demand, number> = { HIGH: 30, MEDIUM: 18, LOW: 8 };

  return MANDIS.filter((mandi) => category === 'All' || mandi.categories.includes(category))
    .filter(
      (mandi) =>
        !needle ||
        mandi.name.toLowerCase().includes(needle) ||
        mandi.district.toLowerCase().includes(needle) ||
        mandi.crops.some((crop) => crop.toLowerCase().includes(needle)),
    )
    .map((mandi) => {
      const distanceKm = origin ? distanceFrom(origin, mandi) : 0;
      const proximity = origin ? Math.max(0, 70 - distanceKm) : 40;
      return {
        ...mandi,
        distanceKm,
        etaMinutes: travelMinutes(distanceKm),
        favourite: favourites.includes(mandi.id),
        score: Math.round(Math.min(100, proximity + demandScore[mandi.demand])),
      };
    })
    .sort((a, b) => {
      if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
      if (origin) return a.distanceKm - b.distanceKm;
      return b.score - a.score;
    });
}
