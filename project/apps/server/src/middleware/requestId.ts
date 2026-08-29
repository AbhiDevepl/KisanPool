import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Every response carries a requestId, success or failure (docs/API_CONTRACTS.md §1). */
export function requestId(req: Request, _res: Response, next: NextFunction): void {
  (req as Request & { requestId?: string }).requestId = `req_${randomUUID()}`;
  next();
}
