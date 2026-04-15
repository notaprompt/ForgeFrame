/**
 * @forgeframe/server — Event Emitter
 *
 * Hook point for extensions to attach without the MIT layer knowing.
 */

import { EventEmitter } from 'events';
import type { Memory, MemoryEdge, GuardianTemperature, HebbianBatchUpdate, ConsolidationProposal, ConsolidationResult, ContradictionProposal, ContradictionResult, NremResult, RemResult, SleepPressure, SourceCalibrationEntry } from '@forgeframe/memory';

/* ---------- Dream event payloads ---------- */

export interface DreamStartedEvent {
  phase: string;
  sleepPressure: number;
  trigger: string;
}

export interface DreamJournalWrittenEvent {
  memoryId: string;
  phase: string;
  pressureBefore: number;
  pressureAfter: number;
}

export interface DreamSeedSentEvent {
  seedId: string;
  memoryIds: string[];
  connectionSummary: string;
}

export interface DreamSeedGradedEvent {
  seedId: string;
  grade: string;
  responseTimeMs: number;
}

export interface DreamHindsightSentEvent {
  memoryId: string;
  concernSummary: string;
}

export interface DreamHindsightRespondedEvent {
  memoryId: string;
  action: string;
  previousWeight: number;
  newWeight: number | null;
}

export interface DreamTensionDetectedEvent {
  memoryIds: string[];
  tensionSummary: string;
  type: string;
}

export interface DreamAbortedEvent {
  reason: string;
  phase: string;
}

/* ---------- Hermes event payloads ---------- */

export interface HermesCycleStartedEvent {
  trigger: string;
  guardianState: string;
}

export interface HermesCycleCompleteEvent {
  tasksTriaged: number;
  artifactsGenerated: number;
  skillsExtracted: number;
  durationMs: number;
}

export interface HermesTaskExecutingEvent {
  taskId: string;
  taskSummary: string;
  model: string;
}

export interface HermesSuppressedEvent {
  reason: string;
}

export interface HermesCycleTimeoutEvent {
  durationMs: number;
}

/* ---------- Guardian event payloads ---------- */

export interface GuardianDevActiveEvent {
  idleSeconds: number;
  state: string;
}

/* ---------- Valence event payloads ---------- */

export interface ValenceClassifiedEvent {
  memoryId: string;
  valence: string;
  method: string;
}

/* ---------- Calibration event payloads ---------- */

export interface DreamCalibrationEvent {
  entries: SourceCalibrationEntry[];
}

export interface ServerEventMap {
  'memory:created': [memory: Memory];
  'memory:accessed': [memory: Memory];
  'memory:updated': [memory: Memory];
  'memory:deleted': [id: string];
  'memory:decayed': [count: number];
  'memory:promoted': [memory: Memory];
  'session:started': [sessionId: string];
  'session:ended': [sessionId: string];
  'edge:created':   [edge: MemoryEdge];
  'edge:deleted':   [edgeId: string];
  'guardian:update': [temp: GuardianTemperature];
  'hebbian:batch-update': [update: HebbianBatchUpdate];
  'consolidation:proposed': [proposal: ConsolidationProposal];
  'consolidation:complete': [result: ConsolidationResult];
  'consolidation:rejected': [proposal: ConsolidationProposal];
  'contradiction:scanned': [proposals: ContradictionProposal[]];
  'contradiction:resolved': [result: ContradictionResult];
  'dream:started': [event: DreamStartedEvent];
  'dream:nrem:complete': [result: NremResult];
  'dream:rem:complete': [result: RemResult];
  'dream:journal:written': [event: DreamJournalWrittenEvent];
  'dream:seed:sent': [event: DreamSeedSentEvent];
  'dream:seed:graded': [event: DreamSeedGradedEvent];
  'dream:hindsight:sent': [event: DreamHindsightSentEvent];
  'dream:hindsight:responded': [event: DreamHindsightRespondedEvent];
  'dream:tension:detected': [event: DreamTensionDetectedEvent];
  'dream:aborted': [event: DreamAbortedEvent];
  'dream:calibration': [event: DreamCalibrationEvent];
  'hermes:cycle:started': [event: HermesCycleStartedEvent];
  'hermes:cycle:complete': [event: HermesCycleCompleteEvent];
  'hermes:task:executing': [event: HermesTaskExecutingEvent];
  'hermes:suppressed': [event: HermesSuppressedEvent];
  'hermes:cycle:timeout': [event: HermesCycleTimeoutEvent];
  'guardian:dev_active': [event: GuardianDevActiveEvent];
  'guardian:sleep_pressure': [pressure: SleepPressure];
  'valence:classified': [event: ValenceClassifiedEvent];
}

export class ServerEvents extends EventEmitter<ServerEventMap> {}
