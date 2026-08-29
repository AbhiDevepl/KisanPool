/**
 * The mandi layer.
 *
 * Mandis are now created by an operator in the admin console and stored in the
 * database (ADR-039). The app fetches the active ones near the farmer; there is
 * no static list any more. Price bands / opening hours are not part of an
 * operator-created mandi, so the discovery UI degrades gracefully without them.
 */
import type { MandiDTO } from '@kisanpool/shared';
import { api } from './api';

export type Category = 'Vegetables' | 'Fruits' | 'Grains';
export type Demand = 'HIGH' | 'MEDIUM' | 'LOW';
export type Trend = 'UP' | 'FLAT' | 'DOWN';

export interface CommodityPrice {
  crop: string;
  min: number;
  max: number;
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
  opensAt: number;
  closesAt: number;
  demand: Demand;
  prices: CommodityPrice[];
}

export const CATEGORIES: Array<'All' | Category> = ['All', 'Vegetables', 'Fruits', 'Grains'];

const fromDTO = (m: MandiDTO): Mandi => ({
  id: m._id,
  name: m.name,
  district: m.city,
  state: m.state,
  lat: m.location.lat,
  lng: m.location.lng,
  categories: [],
  crops: m.crops ?? [],
  hours: 'Hours vary — check locally',
  opensAt: 0,
  closesAt: 24 * 60, // treat as always open; operator mandis carry no hours
  demand: 'MEDIUM',
  prices: [],
});

// last fetched set, so findMandi() stays synchronous for favourites/labels
let cache: Mandi[] = [];

/** Active operator mandis near `origin` (or all, when location is unknown). */
export async function refreshMandis(
  origin?: { lat: number; lng: number } | null,
  radiusKm = 150,
): Promise<Mandi[]> {
  const dtos = await api.mandis(origin ? { ...origin, radiusKm } : undefined);
  cache = dtos.map(fromDTO);
  return cache;
}

export const findMandi = (id?: string | null): Mandi | undefined =>
  cache.find((mandi) => mandi.id === id);

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

/** Best modal price on offer, or null when the mandi carries no price bands. */
export const topModalPrice = (mandi: Mandi): CommodityPrice | null =>
  mandi.prices.length
    ? mandi.prices.reduce((best, price) => (price.modal > best.modal ? price : best), mandi.prices[0])
    : null;

export const DEMAND_LABEL: Record<Demand, string> = {
  HIGH: 'High demand',
  MEDIUM: 'Medium demand',
  LOW: 'Low demand',
};

export interface RankedMandi extends Mandi {
  distanceKm: number;
  etaMinutes: number;
  favourite: boolean;
  score: number;
}

/**
 * Rank the given mandis for one farmer. Closeness dominates; favourites float up.
 */
export function rankMandis(
  mandis: Mandi[],
  origin: { lat: number; lng: number } | null,
  favourites: string[],
  filters: { category?: 'All' | Category; query?: string } = {},
): RankedMandi[] {
  const { category = 'All', query = '' } = filters;
  const needle = query.trim().toLowerCase();

  return mandis
    .filter((mandi) => category === 'All' || mandi.categories.includes(category))
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
        score: Math.round(Math.min(100, proximity + 18)),
      };
    })
    .sort((a, b) => {
      if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
      if (origin) return a.distanceKm - b.distanceKm;
      return b.score - a.score;
    });
}
