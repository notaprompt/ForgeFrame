/**
 * @forgeframe/server — Event Emitter
 *
 * Hook point for L4 (TRIM/Guardian) to attach without the MIT layer knowing.
 */

import { EventEmitter } from 'events';
import type { Memory } from '@forgeframe/memory';

export interface ServerEventMap {
  'memory:created': [memory: Memory];
  'memory:accessed': [memory: Memory];
  'memory:updated': [memory: Memory];
  'memory:deleted': [id: string];
  'memory:decayed': [count: number];
  'session:started': [sessionId: string];
  'session:ended': [sessionId: string];
}

export class ServerEvents extends EventEmitter<ServerEventMap> {}
