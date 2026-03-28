/**
 * @forgeframe/server — Bearer Token Auth Middleware
 *
 * Optional auth via FORGEFRAME_TOKEN env var.
 * SSE clients (EventSource) cannot set headers, so token is also accepted as a query param.
 */

import type { MiddlewareHandler } from 'hono';

export function bearerAuth(token: string | undefined): MiddlewareHandler {
  if (!token) return async (_c, next) => next();

  return async (c, next) => {
    const header = c.req.header('Authorization');
    const queryToken = c.req.query('token');
    const provided = header?.replace('Bearer ', '') ?? queryToken;

    if (provided !== token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  };
}
