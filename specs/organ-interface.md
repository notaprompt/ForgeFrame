# ForgeFrame Organ Interface Specification

**Version:** 0.1.0-draft
**Status:** RFC
**Author:** Alex Camp / Guardian Labs

---

## 1. Purpose

ForgeFrame is not a framework. It is a **sovereign AI runtime** — an operating
environment where independently-built capabilities compose under constitutional
governance. Each capability is an **organ**: a self-describing unit of work that
declares what it does, what it needs, and what rules it agrees to operate under.

This specification defines the contract between ForgeFrame and any organ —
whether built in-house, imported from open source (MemOS, GOT-OCR2, AgentScope),
or contributed by third parties.

The organism is proprietary. The organ interface is open.

---

## 2. Design Principles

1. **Organs are replaceable; the constitution is not.** Any organ can be swapped
   for a better one. The sovereignty rules, decay policies, and trust boundaries
   are permanent.

2. **Declare, don't assume.** Every organ explicitly states its capabilities,
   resource needs, trust requirements, and data contracts. The runtime never
   guesses.

3. **Graceful degradation over hard failure.** If an organ is unavailable, the
   runtime falls back to the next capable organ or skips the operation. The
   organism adapts to the body it's running in.

4. **Provenance is mandatory.** Every organ that touches data records what it
   did. The audit trail is constitutional — it cannot be disabled.

5. **Sovereignty by default.** An organ that doesn't declare a trust level is
   assumed to be `local-only`. Cloud access is opt-in, never opt-out.

---

## 3. Organ Categories

Organs are typed by **what they do**, not how they're implemented.

```typescript
type OrganCategory =
  | 'inference'      // generates text, code, reasoning (LLMs, specialist models)
  | 'perception'     // processes non-text input (OCR, vision, audio, video)
  | 'memory'         // stores, retrieves, schedules, decays information
  | 'routing'        // decides which organ handles a given intent
  | 'scrubbing'      // sanitizes data before it crosses trust boundaries
  | 'embedding'      // generates vector representations
  | 'extraction'     // pulls structured data from unstructured input
  | 'orchestration'  // coordinates multi-organ pipelines
  | 'intake'         // ingests data from external sources (Distillery, imports)
  | 'surface';       // presents the organism to users (Guardian, Cockpit, CLI)
```

A single organ may declare multiple categories. A 580M OCR model is both
`perception` and `extraction`. The Distillery is both `intake` and
`orchestration`.

---

## 4. Organ Manifest

Every organ ships a manifest. This is the contract.

```typescript
interface OrganManifest {
  /** Unique identifier. Reverse-domain recommended: 'forgeframe.memory.sqlite' */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semver version */
  version: string;

  /** What this organ does */
  description: string;

  /** Functional categories */
  categories: OrganCategory[];

  /** What this organ can do — the capability contract */
  capabilities: OrganCapability[];

  /** What this organ requires to run */
  resources: OrganResources;

  /** Trust and sovereignty declaration */
  trust: OrganTrust;

  /** What data this organ accepts and produces */
  io: OrganIO;

  /** Lifecycle hooks */
  lifecycle: OrganLifecycle;

  /** Optional: organs this organ depends on */
  dependencies?: string[];

  /** Optional: organs this organ can replace (for fallback chains) */
  replaces?: string[];

  /** Optional: origin metadata for imported open-source organs */
  provenance?: OrganProvenance;
}
```

---

## 5. Capabilities

Capabilities are the **verbs** of the system. An organ declares what actions it
can perform, so the routing layer can match intent to capability without
hardcoding model names or tiers.

```typescript
interface OrganCapability {
  /** Action identifier: 'ocr', 'reason', 'embed', 'classify', 'code', 'summarize' */
  action: string;

  /** How well this organ performs this action (0.0 - 1.0, self-assessed) */
  quality: number;

  /** Relative speed for this action: 'instant' | 'fast' | 'moderate' | 'slow' */
  speed: 'instant' | 'fast' | 'moderate' | 'slow';

  /** Input modalities this capability accepts */
  inputModalities: Modality[];

  /** Output modalities this capability produces */
  outputModalities: Modality[];

  /** Optional: specific domains where this capability excels */
  domains?: string[];

  /** Optional: languages supported (ISO 639-1) */
  languages?: string[];
}

type Modality =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'structured-data'   // JSON, tables, SQL results
  | 'embedding-vector'
  | 'graph'             // knowledge graph nodes/edges
  | 'binary';
```

### Capability Examples

```typescript
// GOT-OCR2 (580M) — specialist perception organ
capabilities: [
  {
    action: 'ocr',
    quality: 0.92,
    speed: 'fast',
    inputModalities: ['image', 'pdf'],
    outputModalities: ['text', 'structured-data'],
    domains: ['tables', 'charts', 'equations', 'latex', 'receipts'],
  }
]

// Qwen3-0.6B — ultra-light inference organ
capabilities: [
  {
    action: 'classify',
    quality: 0.75,
    speed: 'instant',
    inputModalities: ['text'],
    outputModalities: ['text', 'structured-data'],
  },
  {
    action: 'reason',
    quality: 0.60,
    speed: 'fast',
    inputModalities: ['text'],
    outputModalities: ['text'],
    domains: ['chain-of-thought'],
  }
]

// Claude Opus — deep inference organ
capabilities: [
  {
    action: 'reason',
    quality: 0.99,
    speed: 'slow',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    domains: ['architecture', 'analysis', 'complex-reasoning'],
  },
  {
    action: 'code',
    quality: 0.97,
    speed: 'moderate',
    inputModalities: ['text'],
    outputModalities: ['text'],
  }
]

// MemOS — pluggable memory backend organ
capabilities: [
  {
    action: 'store',
    quality: 0.90,
    speed: 'fast',
    inputModalities: ['text', 'structured-data', 'embedding-vector', 'graph'],
    outputModalities: ['text', 'structured-data', 'graph'],
    domains: ['temporal-reasoning', 'skill-memory', 'lifecycle-management'],
  },
  {
    action: 'retrieve',
    quality: 0.93,
    speed: 'fast',
    inputModalities: ['text', 'embedding-vector'],
    outputModalities: ['text', 'structured-data', 'graph'],
  }
]
```

---

## 6. Resources

Every organ declares what it costs to run. The runtime uses this to decide what
can be hot (loaded), warm (available but not loaded), or cold (available but
requires setup).

```typescript
interface OrganResources {
  /** RAM required when loaded, in MB */
  ramMb: number;

  /** VRAM required when loaded, in MB. 0 = CPU-only. */
  vramMb: number;

  /** Disk space required for model/data files, in MB */
  diskMb: number;

  /** Does this organ require network access? */
  network: boolean;

  /** Startup time estimate */
  warmupTime: 'instant' | 'seconds' | 'minutes';

  /** Can multiple requests run concurrently? */
  concurrent: boolean;

  /** Optional: GPU compute capability required (e.g., 'metal', 'cuda') */
  compute?: string;

  /** Optional: maximum concurrent requests if concurrent=true */
  maxConcurrency?: number;
}
```

### Resource Budget

The runtime maintains a resource budget based on the host machine:

```typescript
interface ResourceBudget {
  totalRamMb: number;
  totalVramMb: number;
  availableRamMb: number;
  availableVramMb: number;
  compute: string[];      // ['metal'] on Mac, ['cuda'] on Nvidia, etc.
  networkAllowed: boolean; // constitutional override
}
```

The registry uses the budget to determine:
- Which organs **can** be loaded (fit within resources)
- Which organs **should** be hot (frequently used, fast startup not needed)
- Which organs should be warm (available on demand)
- Which organs are cold (installable but not loaded)

---

## 7. Trust Model

Trust is the constitutional layer. It determines what data an organ can see and
where that data can go.

```typescript
interface OrganTrust {
  /**
   * Where this organ's computation happens:
   * - 'local-only': runs entirely on this machine. no network.
   * - 'local-preferred': runs locally if possible, cloud fallback with scrubbing.
   * - 'cloud-scrubbed': sends data to cloud, but only after PII scrubbing.
   * - 'cloud-raw': sends data to cloud as-is (user's explicit choice).
   */
  execution: 'local-only' | 'local-preferred' | 'cloud-scrubbed' | 'cloud-raw';

  /**
   * What data classifications this organ is allowed to process:
   * - 'public': non-sensitive data only
   * - 'internal': general personal/work data
   * - 'sensitive': PII, financial, health data
   * - 'cognitive': awareness traps, psychological patterns, TRIM biotypes
   * - 'constitutional': principles, voice, identity kernel
   */
  dataClassifications: DataClassification[];

  /**
   * Can this organ persist data beyond the current request?
   * If true, must declare where and how (governed by constitution).
   */
  canPersist: boolean;

  /**
   * Does this organ make outbound network calls?
   * Must be true if execution is cloud-*. Must declare endpoints.
   */
  networkEndpoints?: string[];

  /**
   * Does this organ report telemetry or analytics?
   * Constitutional violation if true without explicit user consent.
   */
  telemetry: boolean;
}

type DataClassification =
  | 'public'
  | 'internal'
  | 'sensitive'
  | 'cognitive'
  | 'constitutional';
```

### Constitutional Enforcement Rules

These are **not configurable**. They are the immune system.

1. **Cognitive and constitutional data NEVER leaves the machine.**
   An organ with `execution: 'cloud-*'` is constitutionally barred from
   receiving data classified as `cognitive` or `constitutional`. The runtime
   enforces this before the organ ever sees the data.

2. **Telemetry is opt-in, never default.**
   Any organ declaring `telemetry: true` requires explicit user consent at
   registration time. Organs caught making undeclared network calls are
   quarantined.

3. **Sensitive data requires scrubbing before cloud transit.**
   If an organ processes `sensitive` data and has `execution: 'cloud-scrubbed'`,
   the proxy organ MUST be in the pipeline before the data reaches the cloud
   organ. The runtime enforces this ordering.

4. **Provenance logging cannot be disabled.**
   Every organ invocation is logged with: timestamp, organ ID, input hash,
   output hash, data classifications touched, and trust level used.

5. **Sovereignty is the default.**
   An organ that doesn't declare `trust` is treated as
   `{ execution: 'local-only', dataClassifications: ['public'], canPersist: false, telemetry: false }`.
   Cloud access requires explicit declaration. The constitution assumes nothing
   leaves the machine unless the organ and the user both say so.

---

## 8. Input / Output Contract

Organs declare what they consume and produce. This enables the runtime to
validate pipelines before execution and compose organs into chains.

```typescript
interface OrganIO {
  /** What this organ accepts as input */
  inputs: IOSlot[];

  /** What this organ produces as output */
  outputs: IOSlot[];
}

interface IOSlot {
  /** Slot name (for pipeline wiring): 'text', 'image', 'query', 'memories' */
  name: string;

  /** Data modality */
  modality: Modality;

  /** Is this slot required or optional? */
  required: boolean;

  /** Optional: schema reference for structured data (JSON Schema) */
  schema?: string;

  /** Data classification of this slot (for trust enforcement) */
  classification: DataClassification;
}
```

### Pipeline Composition

When organs chain together, outputs wire to inputs by modality and name:

```
Distillery Pipeline:
  ios-share (intake)
    → output: { name: 'raw_text', modality: 'text', classification: 'internal' }

  got-ocr2 (perception)     [if input is image/pdf]
    → input:  { name: 'image', modality: 'image' }
    → output: { name: 'extracted_text', modality: 'text', classification: 'internal' }

  qwen3.5-27b (inference)   [distillation pass]
    → input:  { name: 'text', modality: 'text' }
    → output: { name: 'distilled', modality: 'text', classification: 'internal' }

  claude-opus (inference)    [refinement pass, optional escalation]
    → input:  { name: 'text', modality: 'text' }
    → output: { name: 'refined', modality: 'text', classification: 'internal' }

  forgeframe-memory (memory) [close the loop]
    → input:  { name: 'content', modality: 'text', classification: 'internal' }
    → output: { name: 'memory_id', modality: 'structured-data' }
```

The runtime validates:
1. Every required input slot has a source (another organ's output or user input)
2. Data classification doesn't escalate without a scrubbing organ in between
3. Trust boundaries are respected (no `cloud-raw` organ after a `cognitive` source)

---

## 9. Lifecycle

Organs have a lifecycle managed by the runtime. They don't manage themselves.

```typescript
interface OrganLifecycle {
  /**
   * Called when the organ is registered with the runtime.
   * Returns true if the organ is ready, false if dependencies are missing.
   */
  register(): Promise<boolean>;

  /**
   * Called to load the organ into active memory (model loading, DB connections).
   * The runtime calls this based on resource budget and demand.
   */
  activate(): Promise<void>;

  /**
   * Called to process a request. The core execution path.
   */
  execute(input: OrganInput): Promise<OrganOutput>;

  /**
   * Called to unload the organ from active memory.
   * Must release all resources (VRAM, file handles, connections).
   */
  deactivate(): Promise<void>;

  /**
   * Health check. Called periodically by the runtime.
   */
  health(): Promise<OrganHealth>;
}

interface OrganInput {
  /** Request ID for provenance tracking */
  requestId: string;

  /** Named input slots with their data */
  slots: Record<string, unknown>;

  /** Context from the constitution (relevant memories, session info) */
  context?: OrganContext;
}

interface OrganOutput {
  /** Named output slots with their data */
  slots: Record<string, unknown>;

  /** Provenance metadata from this organ's processing */
  provenance: OrganProvenanceRecord;
}

interface OrganHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  message?: string;
  latencyMs?: number;
  resourceUsage?: {
    ramMb: number;
    vramMb: number;
  };
}

interface OrganContext {
  /** Relevant memories retrieved by the runtime */
  memories?: Array<{ content: string; strength: number; tags: string[] }>;

  /** Current session metadata */
  session?: { id: string; metadata: Record<string, unknown> };

  /** Constitutional constraints active for this request */
  constraints?: ConstitutionalConstraint[];
}

interface ConstitutionalConstraint {
  rule: string;
  enforcement: 'block' | 'scrub' | 'warn' | 'log';
}
```

### Lifecycle States

```
               register()
  UNKNOWN ──────────────────► REGISTERED
                                  │
                           activate()
                                  │
                                  ▼
                              ACTIVE ◄──────┐
                                  │         │
                           execute()   health() ── OK
                                  │         │
                                  ▼         │
                             EXECUTING ─────┘
                                  │
                          deactivate()
                                  │
                                  ▼
                              DORMANT
                                  │
                           activate()
                                  │
                                  ▼
                              ACTIVE
```

**REGISTERED**: Manifest validated, dependencies checked, not loaded.
**ACTIVE**: Resources allocated, ready to execute.
**EXECUTING**: Currently processing a request.
**DORMANT**: Was active, resources released, can reactivate.

The runtime manages transitions. Organs never self-activate or self-deactivate.

---

## 10. Organ Registry

The registry is the organism's nervous system. It knows every organ, its state,
and how to compose them.

```typescript
interface OrganRegistry {
  /** Register a new organ. Validates manifest, checks dependencies. */
  register(manifest: OrganManifest, implementation: OrganLifecycle): Promise<void>;

  /** Remove an organ. Deactivates first if active. */
  unregister(organId: string): Promise<void>;

  /** Find organs that can handle a given action + modality + trust requirement */
  resolve(query: OrganQuery): OrganMatch[];

  /** Get the current state of an organ */
  status(organId: string): OrganStatus;

  /** List all registered organs */
  list(): OrganStatus[];

  /** Get the current resource budget */
  budget(): ResourceBudget;
}

interface OrganQuery {
  /** What action is needed */
  action: string;

  /** What input modality is available */
  inputModality?: Modality;

  /** What output modality is needed */
  outputModality?: Modality;

  /** Maximum acceptable trust level (ceiling) */
  maxTrust?: OrganTrust['execution'];

  /** Data classification of the input (for trust filtering) */
  dataClassification?: DataClassification;

  /** Preferred speed */
  preferSpeed?: boolean;

  /** Preferred quality */
  preferQuality?: boolean;
}

interface OrganMatch {
  organ: OrganManifest;
  capability: OrganCapability;
  /** Composite score based on quality, speed, resource cost, trust fit */
  score: number;
  /** Current state — prefer ACTIVE organs over DORMANT */
  state: 'active' | 'dormant' | 'registered';
}

interface OrganStatus {
  manifest: OrganManifest;
  state: 'registered' | 'active' | 'executing' | 'dormant' | 'error';
  activeSince?: number;
  lastExecuted?: number;
  executionCount: number;
  averageLatencyMs: number;
  errors: number;
}
```

### Resolution Algorithm

When the runtime needs an organ for a task:

1. **Filter by capability**: which organs declare the needed `action`?
2. **Filter by trust**: which organs are constitutionally allowed to see this data?
3. **Filter by modality**: which organs accept the available input format?
4. **Filter by resources**: which organs fit in the current budget?
5. **Score remaining candidates**:
   - Quality weight (0.4) — capability.quality
   - Speed weight (0.2) — capability.speed mapped to 0-1
   - State weight (0.2) — ACTIVE > DORMANT > REGISTERED (avoids cold starts)
   - Cost weight (0.2) — inverse of resource requirements
6. **Return sorted matches** — caller (routing organ or runtime) picks the top.

Weights are tunable per-request via `preferSpeed` / `preferQuality`.

---

## 11. Organ Chains (Pipelines)

Complex tasks require multiple organs working in sequence. An **organ chain** is
a declared pipeline that the runtime validates and executes.

```typescript
interface OrganChain {
  /** Chain identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Ordered steps in the chain */
  steps: OrganChainStep[];

  /** What triggers this chain (manual, on-intake, on-schedule, on-query) */
  trigger: 'manual' | 'on-intake' | 'on-schedule' | 'on-query';

  /** Optional: cron expression if trigger is 'on-schedule' */
  schedule?: string;
}

interface OrganChainStep {
  /** Which organ handles this step (by ID or by capability query) */
  organ?: string;
  query?: OrganQuery;

  /** How to wire this step's inputs from previous outputs */
  inputMap: Record<string, string>;  // { thisInput: 'previousStep.outputName' }

  /** What to do if this step fails */
  onFailure: 'skip' | 'abort' | 'fallback';

  /** Optional: fallback organ if primary fails */
  fallbackOrgan?: string;

  /** Is this step conditional? */
  condition?: OrganChainCondition;
}

interface OrganChainCondition {
  /** Which previous output to check */
  slot: string;

  /** Condition type */
  check: 'exists' | 'modality-is' | 'classification-is' | 'contains';

  /** Expected value */
  value: string;
}
```

### Example: Distillery Chain

```typescript
const distilleryChain: OrganChain = {
  id: 'distillery.ingest',
  name: 'Distillery Intake Pipeline',
  trigger: 'on-intake',
  steps: [
    {
      // Step 0: OCR if input is image/pdf
      query: { action: 'ocr', inputModality: 'image' },
      inputMap: { image: '$input.raw' },
      onFailure: 'skip',
      condition: {
        slot: '$input.modality',
        check: 'modality-is',
        value: 'image',
      },
    },
    {
      // Step 1: Local distillation (Qwen 3.5 27B)
      query: { action: 'reason', maxTrust: 'local-only', preferSpeed: true },
      inputMap: { text: '$prev.extracted_text || $input.raw' },
      onFailure: 'abort',
    },
    {
      // Step 2: Optional refinement (Claude Opus)
      query: { action: 'reason', preferQuality: true },
      inputMap: { text: '$prev.distilled' },
      onFailure: 'skip',  // graceful — local distillation is good enough
      condition: {
        slot: '$prev.distilled',
        check: 'contains',
        value: '[needs-refinement]',
      },
    },
    {
      // Step 3: Store to sovereign memory
      query: { action: 'store', maxTrust: 'local-only' },
      inputMap: {
        content: '$prev.refined || $prev.distilled',
        tags: '$input.tags',
        source_url: '$input.source_url',
      },
      onFailure: 'abort',
    },
  ],
};
```

---

## 12. Provenance

Every organ invocation produces a provenance record. This is not optional.

```typescript
interface OrganProvenanceRecord {
  /** Unique invocation ID */
  invocationId: string;

  /** Request ID (groups multiple organ invocations in a chain) */
  requestId: string;

  /** Which organ executed */
  organId: string;

  /** Organ version at time of execution */
  organVersion: string;

  /** Timestamp */
  timestamp: number;

  /** Duration in milliseconds */
  durationMs: number;

  /** SHA-256 hash of input (never raw content in provenance) */
  inputHash: string;

  /** SHA-256 hash of output */
  outputHash: string;

  /** Data classifications touched */
  classificationsProcessed: DataClassification[];

  /** Trust level used for this invocation */
  trustLevel: OrganTrust['execution'];

  /** Chain step index, if part of a chain */
  chainStep?: number;

  /** Chain ID, if part of a chain */
  chainId?: string;

  /** Resource consumption */
  resources?: {
    tokensIn?: number;
    tokensOut?: number;
    ramPeakMb?: number;
    vramPeakMb?: number;
  };
}
```

Provenance records are stored in the existing ForgeFrame provenance log
(`~/.forgeframe/provenance.jsonl`), extending the current format. They are
sovereign data — they never leave the machine.

---

## 13. Adapters: Wrapping External Organs

Open-source tools don't ship with ForgeFrame manifests. An **adapter** bridges
an external system into the organ interface.

```typescript
// Example: wrapping MemOS as a ForgeFrame organ

import { OrganManifest, OrganLifecycle } from '@forgeframe/core';

export const memosManifest: OrganManifest = {
  id: 'community.memos.memory',
  name: 'MemOS Memory Backend',
  version: '2.0.0',
  description: 'MemOS memory scheduling, lifecycle management, and multi-substrate storage',
  categories: ['memory'],
  capabilities: [
    {
      action: 'store',
      quality: 0.90,
      speed: 'fast',
      inputModalities: ['text', 'structured-data', 'embedding-vector', 'graph'],
      outputModalities: ['text', 'structured-data', 'graph'],
      domains: ['temporal-reasoning', 'skill-memory', 'lifecycle-management'],
    },
    {
      action: 'retrieve',
      quality: 0.93,
      speed: 'fast',
      inputModalities: ['text', 'embedding-vector'],
      outputModalities: ['text', 'structured-data', 'graph'],
    },
  ],
  resources: {
    ramMb: 512,
    vramMb: 0,
    diskMb: 200,
    network: false,    // local deployment
    warmupTime: 'seconds',
    concurrent: true,
    maxConcurrency: 10,
  },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal', 'sensitive'],
    canPersist: true,
    telemetry: false,
    // Note: cognitive/constitutional data still governed by ForgeFrame's own
    // memory organ. MemOS handles internal/sensitive tier only.
  },
  io: {
    inputs: [
      { name: 'content', modality: 'text', required: true, classification: 'internal' },
      { name: 'query', modality: 'text', required: false, classification: 'internal' },
      { name: 'embedding', modality: 'embedding-vector', required: false, classification: 'internal' },
    ],
    outputs: [
      { name: 'memories', modality: 'structured-data', required: true, classification: 'internal' },
      { name: 'graph', modality: 'graph', required: false, classification: 'internal' },
    ],
  },
  lifecycle: null!, // implemented by adapter class
  provenance: {
    origin: 'https://github.com/MemTensor/MemOS',
    license: 'Apache-2.0',
    importedAt: Date.now(),
    adaptedBy: 'forgeframe-memos-adapter',
  },
};
```

The adapter pattern means:
- ForgeFrame never forks external projects
- External projects don't need to know ForgeFrame exists
- Constitutional governance wraps the organ regardless of its internals
- Upgrades to the external project are isolated to the adapter layer

---

## 14. Backward Compatibility

The current ForgeFrame system (v0.2.0) has working packages that predate this
spec. The migration path:

### Existing Packages as Organs

| Current Package | Organ ID | Categories |
|---|---|---|
| `@forgeframe/memory` | `forgeframe.memory.sqlite` | `memory`, `embedding` |
| `@forgeframe/core` (router) | `forgeframe.routing.intent` | `routing` |
| `@forgeframe/proxy` | `forgeframe.scrubbing.proxy` | `scrubbing` |
| `@forgeframe/server` | `forgeframe.orchestration.mcp` | `orchestration` |

### Current Router → Registry-Driven

The existing `ForgeFrameRouter` with `quick | balanced | deep` tiers becomes
the **default routing organ**. It doesn't go away — it gets a manifest and
registers like everything else. The registry can resolve to it, or to a future
routing organ that does capability-based matching instead of tier matching.

```typescript
// Current: router picks a tier
router.resolveModel(message) → { tier: 'deep', modelId: 'claude-opus' }

// Future: registry resolves by capability
registry.resolve({
  action: 'reason',
  dataClassification: 'internal',
  preferQuality: true,
}) → [{ organ: 'claude-opus', score: 0.95 }, { organ: 'qwen3.5-27b', score: 0.78 }]
```

Both can coexist. The tier router is one routing organ. Capability resolution is
another. The organism decides which to use.

---

## 15. Distilled Artifacts Table

The Distillery's output needs a home in ForgeFrame's data model. This extends
the existing SQLite schema:

```sql
CREATE TABLE IF NOT EXISTS distilled_artifacts (
  id            TEXT PRIMARY KEY,
  source_url    TEXT,
  source_type   TEXT NOT NULL,       -- 'ios-share' | 'manual' | 'watch' | 'import'
  raw_hash      TEXT NOT NULL,       -- SHA-256 of original input
  distilled     TEXT,                -- local model output
  refined       TEXT,                -- frontier model output (nullable)
  organ_chain   TEXT,                -- JSON: [{ organId, version, durationMs }]
  memory_id     TEXT,                -- FK to memories table (NULL until loop closes)
  tags          TEXT DEFAULT '[]',   -- JSON array
  created_at    INTEGER NOT NULL,
  fed_to_memory INTEGER              -- timestamp, NULL until ingested
);

CREATE INDEX IF NOT EXISTS idx_distilled_source ON distilled_artifacts(source_type);
CREATE INDEX IF NOT EXISTS idx_distilled_unfed ON distilled_artifacts(fed_to_memory) WHERE fed_to_memory IS NULL;
```

The `fed_to_memory` / `memory_id` fields are what close the loop. The index on
`fed_to_memory IS NULL` makes it trivial to find everything the organism has
digested but not yet absorbed.

---

## 16. Open Questions

These are intentionally unresolved. They need discussion before v1.0.

1. **Skill memory**: MemOS extracts reusable skills from repeated tasks. Should
   ForgeFrame have a `skill` TRIM tag? Or is skill extraction its own organ?

2. **Memory transformation**: MemOS compiles plaintext memories into model
   weights via fine-tuning. This is powerful but dangerous (could degrade the
   base model). If ForgeFrame supports this, it should be a separate organ with
   its own constitutional constraints. What are the guardrails?

3. **Multi-substrate memory**: The spec supports MemOS (Neo4j + Qdrant + SQLite)
   as a memory organ alongside ForgeFrame's native SQLite. How do we handle
   memory queries that should span both? Does the routing organ query both and
   merge, or does the user choose a memory backend per-request?

4. **Organ marketplace**: If ForgeFrame ships the organ spec publicly, third
   parties could build organs. What's the trust model for community organs?
   Code signing? Manifest auditing? Sandboxing?

5. **The reasoning organ**: Alex identified a layer between "user said
   something" and "organ does something" — intent decomposition, capability
   matching, memory-aware routing. Is this a special organ, or is it the
   runtime itself? Making it an organ means it's replaceable. Making it the
   runtime means it's constitutional.

---

## Appendix A: Organ Provenance (for imported organs)

```typescript
interface OrganProvenance {
  /** Source repository or package */
  origin: string;

  /** License of the original project */
  license: string;

  /** When this organ was imported/adapted */
  importedAt: number;

  /** Who wrote the adapter */
  adaptedBy: string;

  /** Version of the original project this adapter targets */
  upstreamVersion?: string;
}
```

---

## Appendix B: Full Type Exports

All types defined in this spec would be exported from `@forgeframe/core` as the
canonical organ interface:

```typescript
export type {
  OrganManifest,
  OrganCategory,
  OrganCapability,
  OrganResources,
  OrganTrust,
  OrganIO,
  OrganLifecycle,
  OrganInput,
  OrganOutput,
  OrganHealth,
  OrganContext,
  OrganProvenanceRecord,
  OrganProvenance,
  OrganQuery,
  OrganMatch,
  OrganStatus,
  OrganRegistry,
  OrganChain,
  OrganChainStep,
  OrganChainCondition,
  ResourceBudget,
  ConstitutionalConstraint,
  DataClassification,
  Modality,
  IOSlot,
};
```

---

*This spec is a living document. It will evolve as organs are built, imported,
and composed. The constitution does not change. Everything else can.*
