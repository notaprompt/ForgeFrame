/**
 * @forgeframe/proxy -- Proxy Server
 *
 * Localhost reverse proxy HTTP server.
 * Accepts Anthropic/OpenAI-shaped requests, routes through the pipeline.
 */

import { createServer } from 'http';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import type { Logger } from '@forgeframe/core';
import type { ProxyConfig } from './types.js';
import { ProxyPipeline } from './pipeline.js';
import type { PipelineConfig } from './pipeline.js';

export interface ProxyServerOptions {
  config: ProxyConfig;
  pipeline: ProxyPipeline;
}

export function createProxyServer(opts: ProxyServerOptions): Server {
  const { config, pipeline } = opts;
  const logger = config.logger;

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, pipeline, logger);
    } catch (err) {
      logger.error('Proxy request failed:', err);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error', message: String(err) }));
      }
    }
  });

  return server;
}

export function startProxyServer(opts: ProxyServerOptions): Promise<Server> {
  const { config } = opts;
  const server = createProxyServer(opts);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(config.port, config.host, () => {
      config.logger.info(`ForgeFrame proxy listening on http://${config.host}:${config.port}`);
      resolve(server);
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: ProxyPipeline,
  logger: Logger,
): Promise<void> {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'forgeframe' }));
    return;
  }

  // Only accept POST to known API paths
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const path = req.url ?? '/';
  const validPaths = ['/v1/messages', '/v1/chat/completions'];
  if (!validPaths.some((p) => path.startsWith(p))) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Read body
  const body = await readBody(req);
  if (!body) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Empty request body' }));
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (typeof val === 'string') headers[key] = val;
  }

  const isStream = parsed.stream === true;

  const upstreamRequest = {
    method: 'POST',
    path,
    headers,
    body: parsed,
    stream: isStream,
  };

  if (isStream) {
    await handleStream(res, pipeline, upstreamRequest, logger);
  } else {
    await handleNonStream(res, pipeline, upstreamRequest);
  }
}

async function handleNonStream(
  res: ServerResponse,
  pipeline: ProxyPipeline,
  request: { method: string; path: string; headers: Record<string, string>; body: unknown; stream: boolean },
): Promise<void> {
  const response = await pipeline.process(request);
  res.writeHead(response.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response.body));
}

async function handleStream(
  res: ServerResponse,
  pipeline: ProxyPipeline,
  request: { method: string; path: string; headers: Record<string, string>; body: unknown; stream: boolean },
  logger: Logger,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });

  try {
    for await (const chunk of pipeline.processStream(request)) {
      if (chunk.event) {
        res.write(`event: ${chunk.event}\n`);
      }
      res.write(`data: ${chunk.data}\n\n`);
    }
  } catch (err) {
    logger.error('Stream error:', err);
  }

  res.end();
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}
