import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';

function createApp(token: string | undefined) {
  const app = new Hono();
  app.use('/api/*', bearerAuth(token));
  app.get('/api/status', (c) => c.json({ ok: true }));
  return app;
}

describe('bearerAuth', () => {
  it('passes all requests when no token is configured', async () => {
    const app = createApp(undefined);
    const res = await app.request('/api/status');
    expect(res.status).toBe(200);
  });

  it('returns 401 when token is required but not provided', async () => {
    const app = createApp('secret-token');
    const res = await app.request('/api/status');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('accepts valid Bearer header', async () => {
    const app = createApp('secret-token');
    const res = await app.request('/api/status', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects wrong token', async () => {
    const app = createApp('secret-token');
    const res = await app.request('/api/status', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects query param token (no longer accepted)', async () => {
    const app = createApp('secret-token');
    const res = await app.request('/api/status?token=secret-token');
    expect(res.status).toBe(401);
  });

  it('rejects token with different length', async () => {
    const app = createApp('secret-token');
    const res = await app.request('/api/status', {
      headers: { Authorization: 'Bearer short' },
    });
    expect(res.status).toBe(401);
  });
});
