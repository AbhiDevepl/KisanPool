import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { getAccessToken } from './session';

/**
 * One socket per screen that needs it; disconnected on unmount. The JWT rides in
 * the handshake — the same token REST uses (docs/API_CONTRACTS.md §3).
 */
export function useSocket(
  room: { type: 'request' | 'trip'; id: string } | null,
  handlers: Record<string, (payload: never) => void>,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!room?.id) return;

    let socket: Socket | null = null;
    let cancelled = false;

    void (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });

      socket.on('connect', () => {
        if (room.type === 'request') socket?.emit('join:request', { requestId: room.id });
        else socket?.emit('join:trip', { tripId: room.id });
      });

      for (const event of Object.keys(handlersRef.current)) {
        // read through the ref so a re-render's handler is always the one that runs
        socket.on(event, (payload: unknown) => {
          handlersRef.current[event]?.(payload as never);
        });
      }
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [room?.type, room?.id]);
}

/** A long-lived socket for publishing GPS during an active trip. */
export async function connectTripSocket(tripId: string): Promise<Socket | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
  socket.on('connect', () => socket.emit('join:trip', { tripId }));
  return socket;
}
