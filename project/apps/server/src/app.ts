import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/error';
import { ok } from './lib/envelope';
import { localUploadsDir } from './lib/upload';

import { authRouter } from './modules/auth/routes';
import { usersRouter } from './modules/users/routes';
import { vehiclesRouter } from './modules/vehicles/routes';
import { documentsRouter } from './modules/documents/routes';
import { transportRouter } from './modules/transport/routes';
import { poolRouter } from './modules/pooling/routes';
import { paymentsRouter, transportersRouter, webhookRouter } from './modules/payments/routes';
import { walletRouter } from './modules/wallet/routes';
import { mandisRouter, adminMandisRouter } from './modules/mandis/routes';
import { ratingsRouter } from './modules/ratings/routes';
import { aiRouter } from './modules/ai/routes';
import { mapsRouter } from './modules/maps/routes';
import { adminRouter } from './modules/admin/routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(requestId);

  // The webhook verifies an HMAC of the RAW body, so it must be mounted before
  // the JSON parser touches the request (ADR-012).
  app.use('/webhooks', webhookRouter);

  app.use(express.json({ limit: '2mb' }));
  // KYC documents are encrypted at rest and only reachable through the authed
  // /documents/file/* route, which decrypts them (ADR-042). Everything else
  // under /uploads (avatars, etc.) is still served statically.
  app.use('/uploads/kyc', (_req, res) => res.status(404).end());
  app.use('/uploads', express.static(localUploadsDir));

  app.get('/health', (_req, res) => {
    ok(res, { status: 'ok', at: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/vehicles', vehiclesRouter);
  app.use('/documents', documentsRouter);
  app.use('/transport', transportRouter);
  app.use('/pool', poolRouter);
  app.use('/shipments', ratingsRouter);
  app.use('/payments', paymentsRouter);
  app.use('/transporters', transportersRouter);
  app.use('/wallet', walletRouter);
  app.use('/mandis', mandisRouter);
  // specific admin sub-route mounted before the catch-all /admin router
  app.use('/admin/mandis', adminMandisRouter);
  app.use('/ai', aiRouter);
  app.use('/maps', mapsRouter);
  app.use('/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const uploadsPath = path.resolve(localUploadsDir);
