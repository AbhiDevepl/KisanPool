import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config';
import { connectDb } from './db';
import { createApp } from './app';
import { registerSocketHandlers } from './modules/realtime';
import { initJournal } from './modules/resilience/journal';
import { startHealthLoop } from './modules/resilience/health';

async function main(): Promise<void> {
  await connectDb();

  /*
   * Bring the durable recovery journal up and replay its index. Never fatal: a
   * journal problem must not stop the server serving, it only means recovery
   * would have less to work with — and the operator board says so out loud.
   */
  try {
    const journal = await initJournal();
    console.log(
      `[resilience] journal: ${journal.backend}` +
        `${journal.durable ? ' (durable)' : ' (NOT durable — intent is kept on disk instead)'}` +
        `, ${journal.pending} pending`,
    );
  } catch (err) {
    console.error('[resilience] journal unavailable', (err as Error)?.message);
  }

  startHealthLoop();

  const app = createApp();
  const server = http.createServer(app);

  // Socket.io on the same HTTP server — one process, REST and realtime (ADR-004)
  const io = new SocketServer(server, { cors: { origin: '*' } });
  registerSocketHandlers(io);

  server.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}`);
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
