import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config';
import { connectDb } from './db';
import { createApp } from './app';
import { registerSocketHandlers } from './modules/realtime';

async function main(): Promise<void> {
  await connectDb();

  const app = createApp();
  const server = http.createServer(app);

  // Socket.io on the same HTTP server — one process, REST and realtime (ADR-004)
  const io = new SocketServer(server, { cors: { origin: '*' } });
  registerSocketHandlers(io);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] listening on 0.0.0.0:${config.port}`);
    if (config.otp.demoMode) console.log('[server] OTP demo mode — codes are logged, not sent');
    if (!config.razorpay.enabled) console.log('[server] Razorpay not configured — checkout runs in demo mode');
    if (config.admin.usingDefaults) {
      console.warn(
        '[server] admin console is using the DEFAULT credentials (admin/admin) — ' +
          'set ADMIN_USERNAME and ADMIN_PASSWORD before exposing this server',
      );
    }
  });
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
