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
    const t1 = scrubWithRegex(text, tokenMap, this._allowlist);

    // Tier 2: Dictionary
    const t2 = scrubWithDictionary(t1.text, tokenMap, this._blocklist, this._allowlist);

    // Tier 3: LLM (optional, fail-open)
    let t3 = { text: t2.text, redactions: [] as ScrubResult['redactions'] };
    if (this._llmEnabled) {
      t3 = await scrubWithLlm(
        t2.text,
        tokenMap,
        this._allowlist,
        this._ollamaUrl,
        this._ollamaModel,
        this._llmTimeout,
        this._logger,
      );
    }

    return {
      text: t3.text,
      redactions: [...t1.redactions, ...t2.redactions, ...t3.redactions],
    };
  }
}

export { scrubWithRegex } from './regex.js';
export { scrubWithDictionary, loadDictionary, buildAllowlistSet } from './dictionary.js';
export type { DictionaryEntry, DictionaryConfig } from './dictionary.js';
export { scrubWithLlm } from './llm-scrub.js';
