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
// V2 — the two networks added on top of produce pooling
import { machineryRouter } from './modules/machinery/routes';
import { backhaulRouter } from './modules/backhaul/routes';
import { paymentsRouter, transportersRouter, webhookRouter } from './modules/payments/routes';
import { ratingsRouter } from './modules/ratings/routes';
import { aiRouter } from './modules/ai/routes';
import { mapsRouter } from './modules/maps/routes';
import { adminRouter } from './modules/admin/routes';
import { predictionsRouter } from './modules/predictions/routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(requestId);

  // The webhook verifies an HMAC of the RAW body, so it must be mounted before
  // the JSON parser touches the request (ADR-012).
  app.use('/webhooks', webhookRouter);

  app.use(express.json({ limit: '2mb' }));
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
  // V2: Farm Resource Network and Backhaul Network, mounted alongside — never
  // inside — the produce-pooling routes, so V1 paths are untouched
  app.use('/farm', machineryRouter);
  app.use('/backhaul', backhaulRouter);
  app.use('/shipments', ratingsRouter);
  app.use('/payments', paymentsRouter);
  app.use('/transporters', transportersRouter);
  app.use('/ai', aiRouter);
  app.use('/maps', mapsRouter);
  app.use('/admin', adminRouter);
  // advisory risk scoring — read-only, never authoritative (ADR-041)
  app.use('/predictions', predictionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const uploadsPath = path.resolve(localUploadsDir);
