/**
 * @forgeframe/server — Bearer Token Auth Middleware
 *
 * Optional auth via FORGEFRAME_TOKEN env var.
 * Bearer header only — query param auth removed to prevent token leakage in logs/referers.
 */

import { timingSafeEqual } from 'crypto';
import type { MiddlewareHandler } from 'hono';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function bearerAuth(token: string | undefined): MiddlewareHandler {
  if (!token) return async (_c, next) => next();

  return async (c, next) => {
    const header = c.req.header('Authorization');
    const provided = header?.replace('Bearer ', '') ?? '';

    if (!provided || !safeEqual(provided, token)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  };
}
