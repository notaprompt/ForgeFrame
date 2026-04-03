/**
 * @forgeframe/core — Capability Router
 *
 * Registry-driven routing that replaces hardcoded tier matching
 * with capability-based resolution via the organ registry.
 */

import type {
  OrganRegistry,
  OrganMatch,
  OrganContext,
  DataClassification,
} from './organ-types.js';
import type { Logger } from './types.js';
import { createConsoleLogger } from './types.js';

// -- Intent Signal Patterns (mirrored from router.ts) --

const DEEP_SIGNALS: RegExp[] = [
  /\banalyze\b/i,
  /\banalysis\b/i,
  /\bexplain in detail\b/i,
  /\bdeep dive\b/i,
  /\bcompare and contrast\b/i,
  /\bcritique\b/i,
  /\bevaluate\b/i,
  /\bwhy does\b/i,
  /\bwhat are the implications\b/i,
  /\barchitecture\b/i,
  /\bdesign pattern\b/i,
  /\btrade.?offs?\b/i,
  /\bphilosoph/i,
  /\btheor(?:y|etical|ize)\b/i,
  /\bproof\b/i,
  /\bderive\b/i,
  /\bresearch\b/i,
  /\blong.?form\b/i,
];

const QUICK_SIGNALS: RegExp[] = [
  /^(?:what|who|when|where|how) (?:is|are|was|were|do|does|did|can|could|would|should) /i,
  /\bquick(?:ly)?\b/i,
  /\bbrief(?:ly)?\b/i,
  /\btl;?dr\b/i,
  /\bsummar(?:y|ize)\b/i,
  /\bdefine\b/i,
  /\bwhat does .{1,30} mean/i,
  /\bremind me\b/i,
  /\byes or no\b/i,
  /\bone.?liner\b/i,
  /\bshort answer\b/i,
];

const CODE_SIGNALS: RegExp[] = [
  /\bimplement\b/i,
  /\bwrite code\b/i,
  /\bfunction\b/i,
  /\bdebug\b/i,
  /\brefactor\b/i,
  /\bfix (?:the |this )?(?:bug|error|issue)\b/i,
  /\bcode review\b/i,
  /\bunit test\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bpython\b/i,
];

const OCR_SIGNALS: RegExp[] = [
  /\bread this\b/i,
  /\bscan\b/i,
  /\bextract text from\b/i,
  /\bocr\b/i,
  /\bwhat does this (?:image|picture|photo|screenshot) say\b/i,
];

// -- Routing Decision --

export interface RoutingDecision {
  requestId: string;
  classifiedAction: string;
  classifiedDataLevel: DataClassification;
  messagePreview: string;
  candidates: Array<{ organId: string; score: number; reason: string }>;
  selected: string | null;
  timestamp: number;
}

// -- Capability Router --

export class CapabilityRouter {
  private readonly _registry: OrganRegistry;
  private readonly _log: Logger;

  constructor(registry: OrganRegistry, logger?: Logger) {
    this._registry = registry;
    this._log = logger ?? createConsoleLogger();
  }

  route(message: string, context?: OrganContext): OrganMatch[] {
    const action = this.classifyAction(message);
    const dataLevel = this.classifyDataLevel(context);
    const preferSpeed = message.trim().length < 80;
    const preferQuality = message.trim().length > 300;

    this._log.debug(
      `CapabilityRouter: action=${action} data=${dataLevel} speed=${preferSpeed} quality=${preferQuality}`,
    );

    const matches = this._registry.resolve({
      action,
      dataClassification: dataLevel,
      preferSpeed,
      preferQuality,
    });

    return matches;
  }

  explain(message: string, matches: OrganMatch[]): RoutingDecision {
    const action = this.classifyAction(message);
    const dataLevel = this.classifyDataLevel();

    const candidates = matches.map((m) => ({
      organId: m.organ.id,
      score: m.score,
      reason: `capability=${m.capability.action} quality=${m.capability.quality} speed=${m.capability.speed} state=${m.state}`,
    }));

    return {
      requestId: crypto.randomUUID(),
      classifiedAction: action,
      classifiedDataLevel: dataLevel,
      messagePreview: message.slice(0, 100),
      candidates,
      selected: matches.length > 0 ? matches[0].organ.id : null,
      timestamp: Date.now(),
    };
  }

  classifyAction(message: string): string {
    if (!message || typeof message !== 'string') return 'reason';

    const text = message.trim();

    if (OCR_SIGNALS.some((r) => r.test(text))) return 'ocr';

    // Match legacy router priority: short length -> long length -> deep -> quick
    // Short messages without deep signals are quick
    if (text.length < 20 && !DEEP_SIGNALS.some((r) => r.test(text))) return 'classify';

    if (text.length > 500) return 'reason';

    // Deep signals take priority over quick signals (legacy order)
    if (DEEP_SIGNALS.some((r) => r.test(text))) return 'reason';

    // Code signals checked before quick to catch "implement", "debug", etc.
    // but after deep to let "analyze the architecture" stay as reason
    if (CODE_SIGNALS.some((r) => r.test(text))) return 'code';

    if (QUICK_SIGNALS.some((r) => r.test(text))) {
      if (/\bsummar(?:y|ize)\b/i.test(text)) return 'summarize';
      return 'classify';
    }

    return 'reason';
  }

  classifyDataLevel(context?: OrganContext): DataClassification {
    if (!context?.memories || context.memories.length === 0) return 'internal';

    for (const mem of context.memories) {
      if (mem.tags.includes('principle') || mem.tags.includes('voice')) {
        return 'constitutional';
      }
      if (mem.tags.includes('cognitive')) {
        return 'cognitive';
      }
    }

    return 'internal';
  }
}
