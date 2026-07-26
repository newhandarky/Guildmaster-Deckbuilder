import type { Phase } from './state.js';

export type GameCommand =
  | { type: 'PLAY_ADVENTURER'; cardId: string }
  | { type: 'EQUIP_ITEM'; cardId: string; adventurerId: string }
  | { type: 'USE_ITEM'; cardId: string }
  | { type: 'ATTACK_TARGET'; targetId: string }
  | { type: 'BUY_CARD'; cardId: string }
  | { type: 'END_PHASE'; phase: Phase };

export type CommandEnvelope = { protocolVersion: 1; gameId: string; commandId: string; actorId: string; expectedRevision: number; command: GameCommand };

export type DomainEvent = { eventId: string; revision: number; type: string; message: string; causedByCommandId?: string; moduleId?: string };

export type EngineErrorCode = 'STALE_REVISION' | 'NOT_AUTHORIZED' | 'INVALID_COMMAND' | 'RULE_CLARIFICATION_REQUIRED' | 'GAME_FINISHED';
export type EngineError = { code: EngineErrorCode; message: string };
export type EngineResult = { state: import('./state.js').GameState; events: DomainEvent[]; error?: EngineError };
