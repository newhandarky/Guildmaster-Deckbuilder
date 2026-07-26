import type { CardInstance } from './cards.js';

export type Phase = 'action1' | 'combat' | 'action2' | 'purchase' | 'rest';
export type GameStatus = 'playing' | 'finalRound' | 'finished' | 'pendingOfficialRuling';
export type PlayerKind = 'human' | 'ai';

export type PartySlot = { adventurerId: string; equipmentId?: string };
export type BondState = { bondId: string; completed: boolean };

export type PlayerState = {
  id: string;
  name: string;
  kind: PlayerKind;
  drawPile: string[];
  hand: string[];
  discardPile: string[];
  party: PartySlot[];
  playArea: string[];
  bonds: BondState[];
  turnPurchaseBonus: number;
  turnPurchaseSpent: number;
  turnCombatBonus: number;
  history: { defeatedBosses: number; defeatedMonsters: number };
};

export type SharedZones = {
  adventurerDeck: string[];
  adventurerRow: string[];
  itemDeck: string[];
  itemRow: string[];
  monsterDeck: string[];
  monsterRow: string[];
  bossDeck: string[];
  bossRow: string[];
};

export type EnemyTargetState = { targetId: string; cardInstanceId: string; kind: 'monster' | 'boss'; status: 'available' | 'defeated' };
export type EnemyEncounterState = { encounterId: string; targetIds: string[]; kind: 'base:enemies' };

export type EndState = { conditionId: string; finalRoundEndPlayerId: string; triggeredAtRevision: number };

export type GameState = {
  schemaVersion: 1;
  engineVersion: string;
  rulesetVersion: string;
  contentPacks: { id: string; version: string; hash: string }[];
  rulesModules: { id: string; version: string }[];
  gameId: string;
  seed: number;
  rngState: number;
  revision: number;
  status: GameStatus;
  players: PlayerState[];
  activePlayerId: string;
  startingPlayerId: string;
  round: number;
  phase: Phase;
  cards: Record<string, CardInstance>;
  sharedZones: SharedZones;
  enemyTargets: Record<string, EnemyTargetState>;
  enemyEncounters: EnemyEncounterState[];
  removedCards: string[];
  moduleState: Record<string, unknown>;
  endState?: EndState;
  eventLogCursor: number;
};

export type PlayerView = {
  viewerId: string;
  gameId: string;
  status: GameStatus;
  phase: Phase;
  round: number;
  revision: number;
  activePlayerId: string;
  /**
   * A player's own draw pile is deliberately represented as a count only.
   * Its card identities and ordering are hidden from UIs, AIs, and future
   * network clients; rules code may use the complete PlayerState instead.
   */
  self: Omit<PlayerState, 'drawPile'> & { drawPileCount: number };
  /** Effective limit after all currently-enabled Rules Modules are applied. */
  partyLimit: number;
  opponents: { id: string; name: string; handCount: number; partyCount: number; discardCount: number; defeatedBosses: number }[];
  sharedZones: SharedZones;
  enemyTargets: Record<string, EnemyTargetState>;
  cards: Record<string, CardInstance>;
  endState?: EndState;
};
