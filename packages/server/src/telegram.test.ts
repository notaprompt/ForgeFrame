import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  sendTelegram,
  escapeHtml,
  formatMessage,
  telegramConfigured,
  logTelegramStartupStatus,
  __resetTelegramStartupLogForTests,
} from './telegram.js';

describe('sendTelegram', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.FORGEFRAME_TELEGRAM_TOKEN;
  const originalChatId = process.env.FORGEFRAME_TELEGRAM_CHAT_ID;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    __resetTelegramStartupLogForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.FORGEFRAME_TELEGRAM_TOKEN;
    } else {
      process.env.FORGEFRAME_TELEGRAM_TOKEN = originalToken;
    }
    if (originalChatId === undefined) {
      delete process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
    } else {
      process.env.FORGEFRAME_TELEGRAM_CHAT_ID = originalChatId;
    }
    vi.restoreAllMocks();
  });

  it('POSTs to api.telegram.org/bot<TOKEN>/sendMessage with HTML JSON body', async () => {
    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'test-token-123';
    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '42';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await sendTelegram({ title: 'Vision · WARN', body: 'disk filling up' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token-123/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const payload = JSON.parse(init.body);
    expect(payload.chat_id).toBe('42');
    expect(payload.parse_mode).toBe('HTML');
    expect(payload.text).toContain('Vision · WARN');
    expect(payload.text).toContain('disk filling up');
  });

  it('HTML-escapes &, <, > in title and body', async () => {
    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'tok';
    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '1';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await sendTelegram({ title: 'A & B', body: '<script>alert(1)</script>' });

    const [, init] = mockFetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.text).toContain('A &amp; B');
    expect(payload.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(payload.text).not.toContain('<script>');
  });

  it('is a graceful no-op when FORGEFRAME_TELEGRAM_TOKEN is missing', async () => {
    delete process.env.FORGEFRAME_TELEGRAM_TOKEN;
    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '42';
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(sendTelegram({ title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is a graceful no-op when FORGEFRAME_TELEGRAM_CHAT_ID is missing', async () => {
    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'tok';
    delete process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(sendTelegram({ title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when res.ok === false (caller swallows)', async () => {
    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'tok';
    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '1';
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(sendTelegram({ title: 'T', body: 'B' })).rejects.toThrow(
      /telegram POST failed: 429/,
    );
  });
});

describe('escapeHtml', () => {
  it('escapes only &, <, >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('leaves safe characters alone', () => {
    expect(escapeHtml('hello "world" it\'s fine')).toBe('hello "world" it\'s fine');
  });

  it('escapes & first to avoid double-escaping already-escaped entities', () => {
    // "&lt;" must become "&amp;lt;" (the & is escaped, then < has no <)
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('formatMessage', () => {
  it('bolds the title and preserves a newline separator', () => {
    expect(formatMessage('Title', 'Body')).toBe('<b>Title</b>\nBody');
  });

  it('escapes both halves', () => {
    expect(formatMessage('a<b', 'c&d')).toBe('<b>a&lt;b</b>\nc&amp;d');
  });
});

describe('telegramConfigured + logTelegramStartupStatus', () => {
  const originalToken = process.env.FORGEFRAME_TELEGRAM_TOKEN;
  const originalChatId = process.env.FORGEFRAME_TELEGRAM_CHAT_ID;

  beforeEach(() => {
    __resetTelegramStartupLogForTests();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.FORGEFRAME_TELEGRAM_TOKEN;
    } else {
      process.env.FORGEFRAME_TELEGRAM_TOKEN = originalToken;
    }
    if (originalChatId === undefined) {
      delete process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
    } else {
      process.env.FORGEFRAME_TELEGRAM_CHAT_ID = originalChatId;
    }
  });

  it('telegramConfigured false when either env var is missing', () => {
    delete process.env.FORGEFRAME_TELEGRAM_TOKEN;
    delete process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
    expect(telegramConfigured()).toBe(false);

    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'tok';
    expect(telegramConfigured()).toBe(false);

    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '1';
    expect(telegramConfigured()).toBe(true);
  });

  it('logs "unconfigured, skipping" exactly once when env is missing', () => {
    delete process.env.FORGEFRAME_TELEGRAM_TOKEN;
    delete process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
    const log = vi.fn();
    logTelegramStartupStatus(log);
    logTelegramStartupStatus(log);
    logTelegramStartupStatus(log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[telegram] unconfigured, skipping');
  });

  it('logs "configured" exactly once when env is set', () => {
    process.env.FORGEFRAME_TELEGRAM_TOKEN = 'tok';
    process.env.FORGEFRAME_TELEGRAM_CHAT_ID = '1';
    const log = vi.fn();
    logTelegramStartupStatus(log);
    logTelegramStartupStatus(log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[telegram] configured');
  });
});
