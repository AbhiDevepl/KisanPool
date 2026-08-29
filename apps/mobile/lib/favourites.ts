/**
 * Favourite mandis — a starred shortlist the farmer builds.
 *
 * Local to the device on purpose: the backend has no favourites collection and
 * adding one is not worth a migration for this. Everything else the app shows
 * comes from the API; this is the one genuinely per-device preference.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'kp.favouriteMandis';

export async function getFavourites(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function toggleFavourite(mandiId: string): Promise<string[]> {
  const current = await getFavourites();
  const next = current.includes(mandiId)
    ? current.filter((id) => id !== mandiId)
    : [...current, mandiId];
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  return next;
}

export async function isFavourite(mandiId: string): Promise<boolean> {
  return (await getFavourites()).includes(mandiId);
}
