import type { CardInstance } from './cards.js';
import type { EffectExecutionState } from './effects.js';

export type Phase = 'action1' | 'combat' | 'action2' | 'purchase' | 'rest';
export type GameStatus = 'playing' | 'finalRound' | 'finished' | 'pendingOfficialRuling';
export type PlayerKind = 'human' | 'ai';
export type ZoneId = string;

export type PartySlot = { adventurerId: string; equipmentId?: string };
export type BondState = { bondId: string; completed: boolean };
export type PlayerCounterState = { resourceId: string; amount: number; visibility: 'public' | 'ownerOnly' | 'allPlayersByConsent'; sourceRefs?: string[] };
export type PlayerState = {
  id: string; name: string; kind: PlayerKind;
  drawPile: string[]; hand: string[]; discardPile: string[]; party: PartySlot[]; playArea: string[];
  bonds: BondState[]; counters: PlayerCounterState[]; moduleState: Record<string, unknown>;
  turnPurchaseBonus: number; turnPurchaseSpent: number; turnCombatBonus: number;
  history: { defeatedBosses: number; defeatedMonsters: number };
};

export type ZoneKind = 'orderedDeck' | 'faceUpRow' | 'singleSlot' | 'moduleArea';
export type ZoneState = { zoneId: ZoneId; kind: ZoneKind; cardIds: string[]; visibility: 'public' | 'ownerOnly'; ownerId?: string; rulesModuleId?: string; metadata?: Record<string, unknown> };
export type EnemyTargetState = { targetId: string; cardInstanceId: string; kind: string; status: 'available' | 'engaged' | 'defeated' | 'removed'; parentEncounterId?: string; partKey?: string; zoneId?: ZoneId; health?: { current: number; max: number }; attachments: string[]; moduleState: Record<string, unknown> };
export type EnemyEncounterState = { encounterId: string; targetIds: string[]; kind: string; status: 'active' | 'finished'; rulesModuleId?: string; resolutionPolicy?: { moduleId: string; policyId: string }; state: Record<string, unknown> };
export type EndState = { conditionId: string; finalRoundEndPlayerId: string; triggeredAtRevision: number };

export type GameState = {
  schemaVersion: 2; engineVersion: string; rulesetVersion: string;
  contentPacks: { id: string; version: string; hash: string }[]; rulesModules: { id: string; version: string; config?: Record<string, unknown> }[];
  gameId: string; seed: number; rngState: number; revision: number; status: GameStatus;
  players: PlayerState[]; activePlayerId: string; startingPlayerId: string; round: number; phase: Phase;
  cards: Record<string, CardInstance>; zones: Record<ZoneId, ZoneState>;
  enemyTargets: Record<string, EnemyTargetState>; enemyEncounters: EnemyEncounterState[];
  removedCards: string[]; moduleState: Record<string, unknown>; effectState: EffectExecutionState; endState?: EndState; eventLogCursor: number;
};

export type PlayerView = {
  viewerId: string; gameId: string; status: GameStatus; phase: Phase; round: number; revision: number; activePlayerId: string;
  self: Omit<PlayerState, 'drawPile'> & { drawPileCount: number }; partyLimit: number;
  opponents: { id: string; name: string; handCount: number; partyCount: number; discardCount: number; defeatedBosses: number; counters: PlayerCounterState[] }[];
  pendingCounterConsent?: { requestId: string; policy: import('./counter-consent.js').CounterConsentPolicyRef; counterOwnerId: string; requesterId: string; requiredActorIds: readonly string[]; acceptedActorIds: readonly string[]; status: 'pending' };
  zones: Record<ZoneId, ZoneState>; enemyTargets: Record<string, EnemyTargetState>; cards: Record<string, CardInstance>; endState?: EndState;
};
