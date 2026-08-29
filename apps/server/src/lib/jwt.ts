import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from './envelope';

export interface TokenPayload {
  sub: string;
  role: 'FARMER' | 'TRANSPORTER';
  /**
   * Operator tokens carry this claim. Admin is deliberately NOT a User.role —
   * an operator is not an account in the marketplace, and adding it to the role
   * union would put 'ADMIN' into every role-gated query and navigation branch.
   */
  admin?: true;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.accessTokenTtl });
}

/** Short-lived by design — an operator session should not outlive the shift. */
export function signAdminToken(): string {
  return jwt.sign({ sub: 'admin', role: 'FARMER', admin: true } as TokenPayload, config.jwtSecret, {
    expiresIn: config.admin.sessionTtl,
  });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: config.refreshTokenTtl });
}

/** Both REST and the socket handshake verify with this — one identity model, not two. */
export function verifyAccessToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    throw new ApiError('AUTH_UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
}

export function verifyRefreshToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtRefreshSecret) as TokenPayload;
  } catch {
    throw new ApiError('AUTH_UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
}
