/**
 * @forgeframe/server — Event Emitter
 *
 * Hook point for extensions to attach without the MIT layer knowing.
 */

import { EventEmitter } from 'events';
import type { Memory, MemoryEdge, GuardianTemperature } from '@forgeframe/memory';

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
}

export class ServerEvents extends EventEmitter<ServerEventMap> {}
