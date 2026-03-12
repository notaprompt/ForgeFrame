/**
 * @forgeframe/proxy -- ScrubEngineImpl
 *
 * Orchestrates three scrub tiers: regex -> dictionary -> LLM.
 */

import type { Logger } from '@forgeframe/core';
import type { ScrubEngine, ScrubResult, TokenMap, ProxyConfig } from '../types.js';
import { scrubWithRegex } from './regex.js';
import { scrubWithDictionary, loadDictionary, buildAllowlistSet } from './dictionary.js';
import type { DictionaryEntry } from './dictionary.js';
import { scrubWithLlm } from './llm-scrub.js';

export class ScrubEngineImpl implements ScrubEngine {
  private _blocklist: DictionaryEntry[];
  private _allowlist: Set<string>;
  private _llmEnabled: boolean;
  private _ollamaUrl: string;
  private _ollamaModel: string;
  private _llmTimeout: number;
  private _logger: Logger;

  constructor(config: ProxyConfig) {
    const dict = loadDictionary(config.blocklistPath, config.allowlistPath);
    this._blocklist = dict.blocklist;
    this._allowlist = buildAllowlistSet(dict.allowlist);
    this._llmEnabled = config.llmScrubEnabled;
    this._ollamaUrl = config.ollamaUrl;
    this._ollamaModel = config.ollamaModel;
    this._llmTimeout = config.llmScrubTimeout;
    this._logger = config.logger;
  }

  async scrub(text: string, tokenMap: TokenMap): Promise<ScrubResult> {
    // Tier 1: Regex
    const t1Start = performance.now();
    const t1 = scrubWithRegex(text, tokenMap, this._allowlist);
    const t1Ms = performance.now() - t1Start;

    // Tier 2: Dictionary
    const t2Start = performance.now();
    const t2 = scrubWithDictionary(t1.text, tokenMap, this._blocklist, this._allowlist);
    const t2Ms = performance.now() - t2Start;

    // Tier 3: LLM (optional, fail-open)
    let t3 = { text: t2.text, redactions: [] as ScrubResult['redactions'] };
    let t3Ms: number | null = null;
    if (this._llmEnabled) {
      const t3Start = performance.now();
      t3 = await scrubWithLlm(
        t2.text,
        tokenMap,
        this._allowlist,
        this._ollamaUrl,
        this._ollamaModel,
        this._llmTimeout,
        this._logger,
      );
      t3Ms = performance.now() - t3Start;
    }

    this._logger.debug(`Scrub timings: t1=${t1Ms.toFixed(1)}ms t2=${t2Ms.toFixed(1)}ms t3=${t3Ms !== null ? t3Ms.toFixed(1) + 'ms' : 'off'}`);

    return {
      text: t3.text,
      redactions: [...t1.redactions, ...t2.redactions, ...t3.redactions],
      tierTimings: { t1: t1Ms, t2: t2Ms, t3: t3Ms },
    };
  }
}

export { scrubWithRegex } from './regex.js';
export { scrubWithDictionary, loadDictionary, buildAllowlistSet } from './dictionary.js';
export type { DictionaryEntry, DictionaryConfig } from './dictionary.js';
export { scrubWithLlm, checkOllamaHealth, warmupLlmScrub } from './llm-scrub.js';
