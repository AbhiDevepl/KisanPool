import * as SecureStore from 'expo-secure-store';
import type { UserDTO } from '@kisanpool/shared';

const ACCESS = 'kp.accessToken';
const REFRESH = 'kp.refreshToken';
const USER = 'kp.user';

export async function saveSession(
  accessToken: string,
  refreshToken: string,
  user: UserDTO,
): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, accessToken);
  await SecureStore.setItemAsync(REFRESH, refreshToken);
  await SecureStore.setItemAsync(USER, JSON.stringify(user));
}

export const getAccessToken = (): Promise<string | null> => SecureStore.getItemAsync(ACCESS);
export const getRefreshToken = (): Promise<string | null> => SecureStore.getItemAsync(REFRESH);

export async function getUser(): Promise<UserDTO | null> {
  const raw = await SecureStore.getItemAsync(USER);
  return raw ? (JSON.parse(raw) as UserDTO) : null;
}

export async function setUser(user: UserDTO): Promise<void> {
  await SecureStore.setItemAsync(USER, JSON.stringify(user));
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, accessToken);
  await SecureStore.setItemAsync(REFRESH, refreshToken);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS),
    SecureStore.deleteItemAsync(REFRESH),
    SecureStore.deleteItemAsync(USER),
  ]);
}
