/**
 * @forgeframe/server — Telegram push layer
 *
 * Server-originated push notifications via the Telegram Bot API.
 * Token + chat id are read from env (FORGEFRAME_TELEGRAM_TOKEN,
 * FORGEFRAME_TELEGRAM_CHAT_ID). When either is missing, sendTelegram is
 * a graceful no-op — the daemon must not crash on an unconfigured
 * outbound gateway.
 *
 * Outbound-only v1. HTML parse_mode (safer escape rules than MarkdownV2).
 * Native fetch; zero new runtime deps.
 *
 * The token is auth — never log it.
 */

export interface TelegramOptions {
  title: string;
  body: string;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * POST a message to Telegram's sendMessage endpoint. When token or chat id
 * is missing, returns silently (logged once at daemon startup via
 * logTelegramStartupStatus). Throws on HTTP error only so callers can
 * log+swallow in the same fire-and-forget pattern used for ntfy.
 */
export async function sendTelegram(opts: TelegramOptions): Promise<void> {
  const token = process.env.FORGEFRAME_TELEGRAM_TOKEN;
  const chatId = process.env.FORGEFRAME_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return;
  }

  const text = formatMessage(opts.title, opts.body);
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    throw new Error(`telegram POST failed: ${res.status}`);
  }
}

/**
 * HTML-escape a user-supplied string for Telegram HTML parse_mode.
 * Only &, <, > need escaping per Telegram's HTML spec.
 * https://core.telegram.org/bots/api#html-style
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render a title + body pair as a short HTML message. Title is bolded
 * for visual separation; both halves are escaped.
 */
export function formatMessage(title: string, body: string): string {
  return `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`;
}

/**
 * True when both env vars are present. Callers can use this to decide
 * whether to even attempt a telegram send (e.g. to skip a broadcast helper).
 */
export function telegramConfigured(): boolean {
  return Boolean(process.env.FORGEFRAME_TELEGRAM_TOKEN && process.env.FORGEFRAME_TELEGRAM_CHAT_ID);
}

let startupStatusLogged = false;

/**
 * Log telegram configuration status exactly once per process. Intended to
 * be called from daemon/proactive startup — not on every sendTelegram call.
 * Subsequent invocations are no-ops.
 */
export function logTelegramStartupStatus(log: (line: string) => void): void {
  if (startupStatusLogged) return;
  startupStatusLogged = true;
  if (telegramConfigured()) {
    log('[telegram] configured');
  } else {
    log('[telegram] unconfigured, skipping');
  }
}

/**
 * Reset the one-shot startup-log flag. Exported for tests only.
 */
export function __resetTelegramStartupLogForTests(): void {
  startupStatusLogged = false;
}
