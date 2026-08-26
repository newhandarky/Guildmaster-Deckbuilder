import type { Phase } from './state.js';
import { z } from 'zod';

export type GameCommand =
  | { type: 'PLAY_ADVENTURER'; cardId: string }
  | { type: 'EQUIP_ITEM'; cardId: string; adventurerId: string }
  | { type: 'ATTACH_CARD'; cardId: string; adventurerId: string; replaceCardId?: string | undefined }
  | { type: 'USE_ITEM'; cardId: string }
  | { type: 'ACTIVATE_CARD_EFFECT'; cardId: string; targetId: string }
  | { type: 'ATTACK_TARGET'; targetId: string; combatAssistCardId?: string | undefined }
  | { type: 'BUY_CARD'; cardId: string }
  | { type: 'SELECT_BONDS'; offerId: string; bondIds: readonly string[] }
  | { type: 'COMPLETE_BONDS'; bondIds: readonly string[] }
  | { type: 'REFRESH_MARKET'; row: 'adventurer' | 'item'; discardCardId: string; refreshCardIds: readonly string[] }
  | { type: 'RESOLVE_EFFECT_CHOICE'; executionId: string; choiceId: string; optionId: string }
  | { type: 'RESOLVE_EFFECT_ORDER'; executionId: string; orderId: string; orderedCardIds: readonly string[]; removeCardId?: string | undefined }
  | { type: 'RESPOND_COUNTER_CONSENT'; requestId: string; response: 'accept' | 'decline' }
  | { type: 'CANCEL_COUNTER_CONSENT'; requestId: string }
  | { type: 'EXPIRE_COUNTER_CONSENT'; requestId: string }
  | { type: 'END_PHASE'; phase: Phase };

export type CommandEnvelope = { protocolVersion: 1; gameId: string; commandId: string; actorId: string; expectedRevision: number; command: GameCommand };

const nonEmptyId = z.string().trim().min(1);
export const GameCommandSchema: z.ZodType<GameCommand> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PLAY_ADVENTURER'), cardId: nonEmptyId }).strict(),
  z.object({ type: z.literal('EQUIP_ITEM'), cardId: nonEmptyId, adventurerId: nonEmptyId }).strict(),
  z.object({ type: z.literal('ATTACH_CARD'), cardId: nonEmptyId, adventurerId: nonEmptyId, replaceCardId: nonEmptyId.optional() }).strict(),
  z.object({ type: z.literal('USE_ITEM'), cardId: nonEmptyId }).strict(),
  z.object({ type: z.literal('ACTIVATE_CARD_EFFECT'), cardId: nonEmptyId, targetId: nonEmptyId }).strict(),
  z.object({ type: z.literal('ATTACK_TARGET'), targetId: nonEmptyId, combatAssistCardId: nonEmptyId.optional() }).strict(),
  z.object({ type: z.literal('BUY_CARD'), cardId: nonEmptyId }).strict(),
  z.object({ type: z.literal('SELECT_BONDS'), offerId: nonEmptyId, bondIds: z.array(nonEmptyId).length(5) }).strict(),
  z.object({ type: z.literal('COMPLETE_BONDS'), bondIds: z.array(nonEmptyId).min(1).max(5) }).strict(),
  z.object({ type: z.literal('REFRESH_MARKET'), row: z.enum(['adventurer', 'item']), discardCardId: nonEmptyId, refreshCardIds: z.array(nonEmptyId).min(1).max(3) }).strict(),
  z.object({ type: z.literal('RESOLVE_EFFECT_CHOICE'), executionId: nonEmptyId, choiceId: nonEmptyId, optionId: nonEmptyId }).strict(),
  z.object({ type: z.literal('RESOLVE_EFFECT_ORDER'), executionId: nonEmptyId, orderId: nonEmptyId, orderedCardIds: z.array(nonEmptyId).max(8), removeCardId: nonEmptyId.optional() }).strict(),
  z.object({ type: z.literal('RESPOND_COUNTER_CONSENT'), requestId: nonEmptyId, response: z.enum(['accept', 'decline']) }).strict(),
  z.object({ type: z.literal('CANCEL_COUNTER_CONSENT'), requestId: nonEmptyId }).strict(),
  z.object({ type: z.literal('EXPIRE_COUNTER_CONSENT'), requestId: nonEmptyId }).strict(),
  z.object({ type: z.literal('END_PHASE'), phase: z.enum(['action1', 'combat', 'action2', 'purchase', 'rest']) }).strict()
]);
export const CommandEnvelopeSchema: z.ZodType<CommandEnvelope> = z.object({
  protocolVersion: z.literal(1),
  gameId: nonEmptyId,
  commandId: nonEmptyId,
  actorId: nonEmptyId,
  expectedRevision: z.number().finite().int().nonnegative(),
  command: GameCommandSchema
}).strict();

export type DomainEventPayload = { schemaVersion: 1; kind: 'combat-evaluation'; evaluation: import('./combat.js').CombatEvaluation } | { schemaVersion: 1; kind: 'combat-failure'; reasonCode: string } | import('./attack-resolution.js').AttackResolutionEventPayload | { schemaVersion: 1; kind: 'combat-reward-evaluation'; evaluation: import('./combat-reward.js').CombatRewardEvaluation; executedPolicy: import('./combat-reward.js').CombatRewardPolicyRef } | { schemaVersion: 1; kind: 'team-overflow'; policy?: { moduleId: string; policyId: string }; candidateIds: readonly string[] } | import('./encounter.js').EncounterEventPayload | import('./dice.js').DiceRollEventPayload | import('./counter-consent.js').CounterConsentEventPayload;
export type DomainEvent = { eventId: string; revision: number; type: string; message: string; causedByCommandId?: string; moduleId?: string; payload?: DomainEventPayload };

export type EngineErrorCode = 'STALE_REVISION' | 'NOT_AUTHORIZED' | 'INVALID_COMMAND' | 'RULE_CLARIFICATION_REQUIRED' | 'GAME_FINISHED';
export type EngineError = { code: EngineErrorCode; message: string };
export type EngineResult = { state: import('./state.js').GameState; events: DomainEvent[]; error?: EngineError };
