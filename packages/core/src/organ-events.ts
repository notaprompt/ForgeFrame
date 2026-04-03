/**
 * @forgeframe/core — Organ Event System
 *
 * Typed EventEmitter for organ lifecycle and execution events.
 */

import { EventEmitter } from 'events';

export interface OrganEventMap {
  'organ:registered': [organId: string];
  'organ:unregistered': [organId: string];
  'organ:activated': [organId: string];
  'organ:deactivated': [organId: string];
  'organ:executed': [organId: string, durationMs: number];
  'organ:error': [organId: string, error: Error];
  'organ:trust-violation': [organId: string, reason: string];
}

export class OrganEvents extends EventEmitter<OrganEventMap> {}
