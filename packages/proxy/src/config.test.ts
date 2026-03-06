import { describe, it, expect, beforeEach } from 'vitest';
import { loadProxyConfig } from './config.js';
import { PROXY_DEFAULTS } from './types.js';

describe('loadProxyConfig', () => {
  beforeEach(() => {
    // Clean proxy-related env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FORGEFRAME_PROXY_')) delete process.env[key];
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FORGEFRAME_DB_PATH;
  });

  it('returns defaults when no overrides or env vars', () => {
    const config = loadProxyConfig();
    expect(config.port).toBe(PROXY_DEFAULTS.port);
    expect(config.host).toBe(PROXY_DEFAULTS.host);
    expect(config.upstream).toBe('anthropic');
    expect(config.anthropicApiKey).toBeNull();
    expect(config.openaiApiKey).toBeNull();
    expect(config.ollamaUrl).toBe(PROXY_DEFAULTS.ollamaUrl);
    expect(config.ollamaModel).toBe(PROXY_DEFAULTS.ollamaModel);
    expect(config.llmScrubEnabled).toBe(false);
    expect(config.llmScrubTimeout).toBe(PROXY_DEFAULTS.llmScrubTimeout);
    expect(config.maxMemoryResults).toBe(PROXY_DEFAULTS.maxMemoryResults);
    expect(config.allowlistPath).toBeNull();
    expect(config.blocklistPath).toBeNull();
  });

  it('reads from env vars', () => {
    process.env.FORGEFRAME_PROXY_PORT = '9999';
    process.env.FORGEFRAME_PROXY_HOST = '0.0.0.0';
    process.env.FORGEFRAME_PROXY_UPSTREAM = 'openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.FORGEFRAME_PROXY_LLM_SCRUB = 'true';
    process.env.FORGEFRAME_PROXY_LLM_SCRUB_TIMEOUT = '1000';
    process.env.FORGEFRAME_PROXY_MAX_MEMORY = '10';

    const config = loadProxyConfig();
    expect(config.port).toBe(9999);
    expect(config.host).toBe('0.0.0.0');
    expect(config.upstream).toBe('openai');
    expect(config.anthropicApiKey).toBe('sk-ant-test');
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.llmScrubEnabled).toBe(true);
    expect(config.llmScrubTimeout).toBe(1000);
    expect(config.maxMemoryResults).toBe(10);
  });

  it('overrides take precedence over env vars', () => {
    process.env.FORGEFRAME_PROXY_PORT = '9999';
    const config = loadProxyConfig({ port: 5555 });
    expect(config.port).toBe(5555);
  });
});
