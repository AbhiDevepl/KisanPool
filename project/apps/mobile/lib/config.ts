/**
 * One place that decides where the backend lives.
 *
 * Both REST and the socket read from here — they used to disagree (a hardcoded
 * LAN IP in api.ts against a localhost fallback in socket.ts), which meant every
 * live update silently died on a real device while REST kept working.
 */
import Constants from 'expo-constants';

const DEFAULT_PORT = 4000;

/**
 * The Metro host the app was served from — on a phone this is the dev machine's
 * LAN IP, which is exactly the host the API is on too. Lets the app work on a
 * teammate's laptop without anyone editing .env.
 */
function hostFromExpo(): string | null {
  const host =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    null;
  const ip = host?.split(':')[0];
  return ip ? `http://${ip}:${DEFAULT_PORT}` : null;
}

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? hostFromExpo() ?? `http://localhost:${DEFAULT_PORT}`;

/** Socket.io shares the API origin unless it is deliberately split out. */
export const SOCKET_URL: string = process.env.EXPO_PUBLIC_SOCKET_URL ?? API_URL;
