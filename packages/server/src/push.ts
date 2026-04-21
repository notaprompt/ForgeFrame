/**
 * @forgeframe/server — ntfy.sh push layer
 *
 * Server-originated push notifications via ntfy.sh.
 * Topic is read from opts.topic or FORGEFRAME_NTFY_TOPIC env.
 * The topic string is the only auth on the free tier — never log it.
 */

export type PushPriority = 'min' | 'low' | 'default' | 'high' | 'urgent';

export interface PushOptions {
  topic?: string;
  title: string;
  body: string;
  priority?: PushPriority;
  tags?: string[];
  click?: string;
}

export async function sendPush(opts: PushOptions): Promise<void> {
  const topic = opts.topic ?? process.env.FORGEFRAME_NTFY_TOPIC;
  if (!topic) {
    throw new Error('sendPush: no topic (pass opts.topic or set FORGEFRAME_NTFY_TOPIC)');
  }
  const headers: Record<string, string> = {
    Title: opts.title,
    Priority: opts.priority ?? 'default',
    Tags: (opts.tags ?? []).join(','),
  };
  if (opts.click) headers.Click = opts.click;

  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers,
    body: opts.body,
  });
  if (!res.ok) {
    throw new Error(`ntfy POST failed: ${res.status}`);
  }
}
