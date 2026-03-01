/**
 * @forgeframe/core — SSE Stream Parser
 *
 * Shared async generator for all HTTP providers.
 * Parses Server-Sent Events from a fetch() Response body.
 */

export interface SSEMessage {
  event: string | null;
  data: string;
}

export async function* parseSSEStream(response: Response): AsyncGenerator<SSEMessage> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      let currentEvent: string | null = null;
      let currentData: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData.push(line.slice(6));
        } else if (line === '' && currentData.length > 0) {
          const dataStr = currentData.join('\n');
          if (dataStr !== '[DONE]') {
            yield { event: currentEvent, data: dataStr };
          }
          currentEvent = null;
          currentData = [];
        }
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let currentEvent: string | null = null;
      let currentData: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData.push(line.slice(6));
        }
      }
      if (currentData.length > 0) {
        const dataStr = currentData.join('\n');
        if (dataStr !== '[DONE]') {
          yield { event: currentEvent, data: dataStr };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
