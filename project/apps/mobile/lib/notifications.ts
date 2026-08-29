import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Push registration.
 *
 * Expo Go dropped remote push in SDK 53 — and `expo-notifications` throws on
 * *import* there, not on use, so it must never be imported at module scope or the
 * screen that pulls this file in crashes before it renders. Everything below loads
 * it lazily, and only once we know we are in a build that supports it.
 *
 * Sockets already cover the foreground case, so a skipped registration costs the
 * live updates nothing — only the backgrounded-app notifications (ADR-005).
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** The parts of expo-notifications we use, so the lazy require stays typed. */
interface NotificationsModule {
  setNotificationHandler: (handler: unknown) => void;
  setNotificationChannelAsync: (id: string, channel: unknown) => Promise<unknown>;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
  AndroidImportance: { HIGH: number };
}

let cached: NotificationsModule | null = null;

function load(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (cached) return cached;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    cached = mod;
    return mod;
  } catch (err) {
    console.warn('[push] expo-notifications unavailable in this build', err);
    return null;
  }
}

/** True when this build can receive remote push at all — the UI can say so honestly. */
export const pushSupported = (): boolean => !isExpoGo;

/**
 * Registered on login and after onboarding. Returns null — never throws — when push
 * is unavailable or the permission is refused; neither is an error worth blocking a
 * farmer's booking over.
 */
export async function registerForPush(): Promise<string | null> {
  if (isExpoGo) {
    console.warn(
      '[push] Expo Go cannot receive remote notifications since SDK 53 — ' +
        'use a development build to test them. Live updates still work over the socket.',
    );
    return null;
  }

  const Notifications = load();
  if (!Notifications) return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Trip updates',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#0d631b',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await api.updateMe({ pushToken: token });
    return token;
  } catch (err) {
    console.warn('[push] registration skipped', err);
    return null;
  }
}
