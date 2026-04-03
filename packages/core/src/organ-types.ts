/**
 * @forgeframe/core — Organ Interface Types
 *
 * The contract between ForgeFrame and any organ — whether built in-house,
 * imported from open source, or contributed by third parties.
 *
 * The organism is proprietary. The organ interface is open.
 */

// -- Category & Classification Types --

export type OrganCategory =
  | 'inference'
  | 'perception'
  | 'memory'
  | 'routing'
  | 'scrubbing'
  | 'embedding'
  | 'extraction'
  | 'orchestration'
  | 'intake'
  | 'surface';

export type Modality =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'structured-data'
  | 'embedding-vector'
  | 'graph'
  | 'binary';

export type DataClassification =
  | 'public'
  | 'internal'
  | 'sensitive'
  | 'cognitive'
  | 'constitutional';

// -- Capability --

export interface OrganCapability {
  /** Action identifier: 'ocr', 'reason', 'embed', 'classify', 'code', 'summarize', etc. */
  action: string;
  /** How well this organ performs this action (0.0–1.0, self-assessed) */
  quality: number;
  /** Relative speed for this action */
  speed: 'instant' | 'fast' | 'moderate' | 'slow';
  /** Input modalities this capability accepts */
  inputModalities: Modality[];
  /** Output modalities this capability produces */
  outputModalities: Modality[];
  /** Specific domains where this capability excels */
  domains?: string[];
  /** Languages supported (ISO 639-1) */
  languages?: string[];
}

// -- Resources --

export interface OrganResources {
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
  /** GPU compute capability required */
  compute?: string;
  /** Maximum concurrent requests if concurrent=true */
  maxConcurrency?: number;
}

export interface ResourceBudget {
  totalRamMb: number;
  totalVramMb: number;
  availableRamMb: number;
  availableVramMb: number;
  compute: string[];
  networkAllowed: boolean;
}

// -- Trust --

export interface OrganTrust {
  /**
   * Where this organ's computation happens:
   * - 'local-only': runs entirely on this machine, no network
   * - 'local-preferred': runs locally if possible, cloud fallback with scrubbing
   * - 'cloud-scrubbed': sends data to cloud after PII scrubbing
   * - 'cloud-raw': sends data to cloud as-is (user's explicit choice)
   */
  execution: 'local-only' | 'local-preferred' | 'cloud-scrubbed' | 'cloud-raw';
  /**
   * What data classifications this organ is allowed to process.
   */
  dataClassifications: DataClassification[];
  /** Can this organ persist data beyond the current request? */
  canPersist: boolean;
  /** Outbound network endpoints (required if execution is cloud-*) */
  networkEndpoints?: string[];
  /** Does this organ report telemetry or analytics? */
  telemetry: boolean;
}

// -- I/O --

export interface IOSlot {
  /** Slot name (for pipeline wiring) */
  name: string;
  /** Data modality */
  modality: Modality;
  /** Is this slot required or optional? */
  required: boolean;
  /** JSON Schema reference for structured data */
  schema?: string;
  /** Data classification of this slot */
  classification: DataClassification;
}

export interface OrganIO {
  inputs: IOSlot[];
  outputs: IOSlot[];
}

// -- Lifecycle --

export interface OrganInput {
  /** Request ID for provenance tracking */
  requestId: string;
  /** Named input slots with their data */
  slots: Record<string, unknown>;
  /** Context from the constitution */
  context?: OrganContext;
}

export interface OrganOutput {
  /** Named output slots with their data */
  slots: Record<string, unknown>;
  /** Provenance metadata from this organ's processing */
  provenance: OrganProvenanceRecord;
}

export interface OrganHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  message?: string;
  latencyMs?: number;
  resourceUsage?: {
    ramMb: number;
    vramMb: number;
  };
}

export interface OrganContext {
  memories?: Array<{ content: string; strength: number; tags: string[] }>;
  session?: { id: string; metadata: Record<string, unknown> };
  constraints?: ConstitutionalConstraint[];
}

export interface ConstitutionalConstraint {
  rule: string;
  enforcement: 'block' | 'scrub' | 'warn' | 'log';
}

export interface OrganLifecycle {
  register(): Promise<boolean>;
  activate(): Promise<void>;
  execute(input: OrganInput): Promise<OrganOutput>;
  deactivate(): Promise<void>;
  health(): Promise<OrganHealth>;
}

// -- Provenance --

export interface OrganProvenanceRecord {
  invocationId: string;
  requestId: string;
  organId: string;
  organVersion: string;
  timestamp: number;
  durationMs: number;
  inputHash: string;
  outputHash: string;
  classificationsProcessed: DataClassification[];
  trustLevel: OrganTrust['execution'];
  chainStep?: number;
  chainId?: string;
  resources?: {
    tokensIn?: number;
    tokensOut?: number;
    ramPeakMb?: number;
    vramPeakMb?: number;
  };
}

export interface OrganProvenance {
  origin: string;
  license: string;
  importedAt: number;
  adaptedBy: string;
  upstreamVersion?: string;
}

// -- Manifest --

export interface OrganManifest {
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
  /** Capability contract */
  capabilities: OrganCapability[];
  /** Resource requirements */
  resources: OrganResources;
  /** Trust and sovereignty declaration */
  trust: OrganTrust;
  /** Data contracts */
  io: OrganIO;
  /** Organs this organ depends on */
  dependencies?: string[];
  /** Organs this organ can replace (for fallback chains) */
  replaces?: string[];
  /** Origin metadata for imported open-source organs */
  provenance?: OrganProvenance;
}

// -- Registry --

export type OrganState = 'registered' | 'active' | 'executing' | 'dormant' | 'error';

export interface OrganStatus {
  manifest: OrganManifest;
  state: OrganState;
  activeSince?: number;
  lastExecuted?: number;
  executionCount: number;
  averageLatencyMs: number;
  errors: number;
}

export interface OrganQuery {
  action: string;
  inputModality?: Modality;
  outputModality?: Modality;
  maxTrust?: OrganTrust['execution'];
  dataClassification?: DataClassification;
  preferSpeed?: boolean;
  preferQuality?: boolean;
}

export interface OrganMatch {
  organ: OrganManifest;
  capability: OrganCapability;
  score: number;
  state: OrganState;
}

export interface OrganRegistry {
  register(manifest: OrganManifest, implementation: OrganLifecycle): Promise<void>;
  unregister(organId: string): Promise<void>;
  resolve(query: OrganQuery): OrganMatch[];
  status(organId: string): OrganStatus | null;
  list(): OrganStatus[];
  budget(): ResourceBudget;
}

// -- Organ Chains (Pipelines) --

export interface OrganChain {
  id: string;
  name: string;
  steps: OrganChainStep[];
  trigger: 'manual' | 'on-intake' | 'on-schedule' | 'on-query';
  schedule?: string;
}

export interface OrganChainStep {
  organ?: string;
  query?: OrganQuery;
  inputMap: Record<string, string>;
  onFailure: 'skip' | 'abort' | 'fallback';
  fallbackOrgan?: string;
  condition?: OrganChainCondition;
}

export interface OrganChainCondition {
  slot: string;
  check: 'exists' | 'modality-is' | 'classification-is' | 'contains';
  value: string;
}
