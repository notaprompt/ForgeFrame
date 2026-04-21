import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { sendPush } from './push.js';

describe('sendPush', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.FORGEFRAME_NTFY_TOPIC;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.FORGEFRAME_NTFY_TOPIC;
    } else {
      process.env.FORGEFRAME_NTFY_TOPIC = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('POSTs to ntfy.sh/<topic> with title/priority/tags headers and body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await sendPush({
      topic: 'vision-acamp-abc123',
      title: 'Vision · WARN',
      body: 'disk filling up',
      priority: 'high',
      tags: ['warning', 'warn'],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://ntfy.sh/vision-acamp-abc123');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('disk filling up');
    expect(init.headers).toMatchObject({
      Title: 'Vision · WARN',
      Priority: 'high',
      Tags: 'warning,warn',
    });
  });

  it('throws when res.ok === false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(
      sendPush({
        topic: 'vision-acamp-abc123',
        title: 'Vision · ERR',
        body: 'boom',
      }),
    ).rejects.toThrow(/ntfy POST failed: 500/);
  });

  it('reads from FORGEFRAME_NTFY_TOPIC env when opts.topic is omitted', async () => {
    process.env.FORGEFRAME_NTFY_TOPIC = 'env-topic-xyz';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await sendPush({ title: 'T', body: 'B' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://ntfy.sh/env-topic-xyz');
  });
});
