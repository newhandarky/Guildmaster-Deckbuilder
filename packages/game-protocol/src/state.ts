import type { CardInstance } from './cards.js';
import type { EffectExecutionState } from './effects.js';

export type Phase = 'action1' | 'combat' | 'action2' | 'purchase' | 'rest';
export type GameStatus = 'setup' | 'playing' | 'finalRound' | 'finished' | 'pendingOfficialRuling';
export type PlayerKind = 'human' | 'ai';
export type ZoneId = string;

/** `equipmentId` is retained only for v2 Snapshot migration. New state writes `equipmentIds`. */
export type PartySlot = { adventurerId: string; equipmentIds?: string[]; equipmentId?: string };
export type BondState = { bondId: string; completed: boolean };
export type PlayerCounterState = { resourceId: string; amount: number; visibility: 'public' | 'ownerOnly' | 'allPlayersByConsent'; sourceRefs?: string[] };
export type PlayerState = {
  id: string; name: string; kind: PlayerKind;
  drawPile: string[]; hand: string[]; discardPile: string[]; party: PartySlot[]; playArea: string[];
  bonds: BondState[]; counters: PlayerCounterState[]; moduleState: Record<string, unknown>;
  turnPurchaseBonus: number; turnPurchaseSpent: number; turnCombatBonus: number; turnMarketRefreshed?: boolean;
  history: { defeatedBosses: number; defeatedMonsters: number };
};

export type ZoneKind = 'orderedDeck' | 'faceUpRow' | 'singleSlot' | 'moduleArea';
export type ZoneState = { zoneId: ZoneId; kind: ZoneKind; cardIds: string[]; visibility: 'public' | 'ownerOnly' | 'hidden'; ownerId?: string; rulesModuleId?: string; metadata?: Record<string, unknown> };
export type EnemyTargetState = { targetId: string; cardInstanceId: string; kind: string; status: 'available' | 'engaged' | 'defeated' | 'removed'; parentEncounterId?: string; partKey?: string; zoneId?: ZoneId; health?: { current: number; max: number }; attachments: string[]; moduleState: Record<string, unknown> };
export type PublicEnemyTargetState = EnemyTargetState & { effectiveCombat?: number; combatEligible?: boolean; combatRestrictionReasonCodes?: readonly string[]; maximumPartySlots?: number; participantLimitReasonCode?: string; equipmentSuppressed?: boolean; equipmentSuppressionReasonCodes?: readonly string[] };
export type EnemyEncounterState = { encounterId: string; targetIds: string[]; kind: string; status: 'active' | 'finished'; rulesModuleId?: string; resolutionPolicy?: { moduleId: string; policyId: string }; state: Record<string, unknown> };
export type EndState = { conditionId: string; conditionIds?: string[]; finalRoundEndPlayerId: string; triggeredAtRevision: number };
export type SetupSelectionState = {
  schemaVersion: 1;
  contributionId: string;
  moduleId: string;
  destinationZoneId: ZoneId;
  cardIds: string[];
  definitionIds: string[];
};
export type BondSetupState = { schemaVersion: 1; offerId: string; currentActorId: string; offers: Record<string, string[]>; completedPlayerIds: string[] };
export type TurnFactLedger = {
  schemaVersion: 1; playerId: string;
  adventurersRecruited: number; adventurersAddedToParty: number;
  itemsBought: number; equipmentBought: number; purchasePowerSpent: number;
  extraCardsDrawn: number; itemsUsed: number; bossesDefeated: number; monstersDefeated: number;
  actionPhaseItemsUsed?: number; lastCombatParticipantCount?: number;
  lastCombatDiscardedEquipment?: number; lastCombatDiscardedNonStarterProfessions?: string[];
  monstersUsedForPurchase?: number;
  effectUses?: Record<string, number>;
  enemyCardPurchaseBonusPerCard?: number;
  partyCombatMultipliers?: { definitionId: string; numerator: number; denominator: number; rounding: 'floor' }[];
  marketRefreshed: boolean; combatResolved: boolean; combatSkipped: boolean;
};
export type TemporaryTargetModifier = { modifierId: string; moduleId: string; targetCardId: string; amount: number; expiresAtTurnEndPlayerId: string };
export type PlayerDecisionKind = 'choose-effect-option' | 'discard-card' | 'remove-card' | 'recover-card' | 'choose-market-card' | 'choose-enemy-target' | 'choose-party-member' | 'draft-card' | 'transfer-card' | 'choose-order';
export type PlayerDecisionPrompt = { schemaVersion: 1; decisionKind: PlayerDecisionKind; choiceId: string; minSelections: number; maxSelections: number; options: readonly { id: string; cardId?: string; definitionId?: string }[]; order?: { kind: 'player-deck-top' | 'party'; cardIds: readonly string[]; mayRemove: boolean } };
export type PublicOpponentPartyMember = { adventurerId: string; equipmentIds?: string[]; equipmentId?: string; effectiveCombat: number };
export type OpponentPlayerView = { id: string; name: string; kind: PlayerKind; seatIndex: number; isActive: boolean; handCount: number; partyCount: number; discardCount: number; partyCombat: number; party: PublicOpponentPartyMember[]; defeatedBosses: number; defeatedMonsters: number; bonds: BondState[]; counters: PlayerCounterState[] };

export type GameState = {
  schemaVersion: 2; engineVersion: string; rulesetVersion: string;
  contentPacks: { id: string; version: string; hash: string }[]; rulesModules: { id: string; version: string; config?: Record<string, unknown>; compositionFingerprint?: string }[];
  gameId: string; seed: number; rngState: number; revision: number; status: GameStatus;
  players: PlayerState[]; activePlayerId: string; startingPlayerId: string; round: number; phase: Phase;
  cards: Record<string, CardInstance>; zones: Record<ZoneId, ZoneState>;
  setupSelections?: Record<string, SetupSelectionState>;
  bondSetup?: BondSetupState; turnFacts?: TurnFactLedger;
  enemyTargets: Record<string, EnemyTargetState>; enemyEncounters: EnemyEncounterState[];
  temporaryTargetModifiers?: TemporaryTargetModifier[];
  removedCards: string[]; moduleState: Record<string, unknown>; effectState: EffectExecutionState; endState?: EndState; eventLogCursor: number;
};

export type PlayerView = {
  viewerId: string; gameId: string; status: GameStatus; phase: Phase; round: number; revision: number; activePlayerId: string;
  self: Omit<PlayerState, 'drawPile'> & { drawPileCount: number }; partyLimit: number;
  opponents: OpponentPlayerView[];
  bondSetup?: { schemaVersion: 1; offerId: string; currentActorId: string; offeredBondIds?: readonly string[]; completedPlayerIds: readonly string[] };
  decisionPrompt?: PlayerDecisionPrompt;
  pendingCounterConsent?: { requestId: string; policy: import('./counter-consent.js').CounterConsentPolicyRef; counterOwnerId: string; requesterId: string; requiredActorIds: readonly string[]; acceptedActorIds: readonly string[]; status: 'pending' };
  zones: Record<ZoneId, ZoneState>; enemyTargets: Record<string, PublicEnemyTargetState>; cards: Record<string, CardInstance>; endState?: EndState;
};
