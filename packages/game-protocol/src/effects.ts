import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';

/** Versioned, JSON-only effect language. It carries no card presentation data. */
export type EffectPlayerRef = { kind: 'controller' } | { kind: 'context-player'; key: string } | { kind: 'player-id'; playerId: string };
export type EffectCardRef = { kind: 'context-card'; key: string } | { kind: 'card-instance'; cardInstanceId: string };
export type PlayerZoneName = 'drawPile' | 'hand' | 'discardPile' | 'playArea';
export type EffectCardLocation = { kind: 'player-zone'; player: EffectPlayerRef; zone: PlayerZoneName } | { kind: 'party'; player: EffectPlayerRef; position: number } | { kind: 'equipment'; player: EffectPlayerRef; partyPosition: number } | { kind: 'shared-zone'; zoneId: string } | { kind: 'removed' };
export type EffectCondition = { kind: 'always'; value: boolean } | { kind: 'has-card-at'; card: EffectCardRef; location: EffectCardLocation };
export type EffectValueTarget = { kind: 'turn-purchase-bonus'; player: EffectPlayerRef } | { kind: 'turn-combat-bonus'; player: EffectPlayerRef } | { kind: 'player-counter'; player: EffectPlayerRef; resourceId: string };
export type CombatReward = { kind: 'draw'; count: number } | { kind: 'purchase-bonus'; amount: number } | { kind: 'combat-bonus'; amount: number } | { kind: 'counter'; resourceId: string; amount: number };
export type EffectNode =
  | { kind: 'sequence'; effects: readonly EffectNode[] }
  | { kind: 'conditional'; condition: EffectCondition; whenTrue: EffectNode; whenFalse?: EffectNode }
  | { kind: 'choice'; choiceId: string; actor: EffectPlayerRef; options: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'random'; randomId: string; outcomes: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'move-card'; card: EffectCardRef; from: EffectCardLocation; to: EffectCardLocation; position?: 'top' | 'bottom' | number; permission?: 'controller-only' | 'system'; transferOwnership?: boolean }
  | { kind: 'draw'; player: EffectPlayerRef; count: number }
  | { kind: 'discard-card'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system' }
  | { kind: 'remove-from-game'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system' }
  | { kind: 'modify-value'; target: EffectValueTarget; amount: number }
  | { kind: 'grant-combat-reward'; recipient: EffectPlayerRef; rewards: readonly CombatReward[] }
  | { kind: 'refresh-supply-row'; refreshPolicyId: string }
  | { kind: 'create-enemy-encounter'; encounterId: string; encounterKind: string; rulesModuleId: string; policy: { moduleId: string; policyId: string }; moduleState?: Record<string, unknown> }
  | { kind: 'create-enemy-target'; targetId: string; encounterId: string; card: EffectCardRef; from: EffectCardLocation; targetKind: string; partKey?: string; health?: { current: number; max: number }; moduleState?: Record<string, unknown> }
  | { kind: 'attach-card-to-enemy-target'; targetId: string; card: EffectCardRef; from: EffectCardLocation; position?: 'top' | 'bottom' }
  | { kind: 'damage-enemy-target'; targetId: string; amount: number; policy: { moduleId: string; policyId: string } }
  | { kind: 'defeat-enemy-target'; targetId: string; policy: { moduleId: string; policyId: string } }
  | { kind: 'remove-enemy-target'; targetId: string; policy: { moduleId: string; policyId: string } }
  | { kind: 'finish-enemy-encounter'; encounterId: string; policy: { moduleId: string; policyId: string } };
export type EffectDefinition = { schemaVersion: 1; effectId: string; body: EffectNode };
export type EffectContext = { controllerId: string; cardRefs?: Readonly<Record<string, string>>; playerRefs?: Readonly<Record<string, string>> };
export type PendingEffectChoice = { schemaVersion: 1; executionId: string; choiceId: string; actorId: string; options: readonly { id: string; effect: EffectNode }[]; remaining: readonly EffectNode[]; context: EffectContext };
export type LifecycleHookRef = { moduleId: string; hookId: string };
export type LifecycleRegistrySnapshot = { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
/**
 * Serializable continuation for one transactional lifecycle dispatch.
 * rollbackState is captured before the first hook and never contains this continuation.
 */
export type PendingLifecycleDispatch = {
  schemaVersion: 1;
  dispatchId: string;
  payload: import('./lifecycle.js').LifecyclePayload;
  context: EffectContext;
  currentHook: LifecycleHookRef;
  remainingHooks: readonly LifecycleHookRef[];
  registry: LifecycleRegistrySnapshot;
  rollbackState: import('./state.js').GameState;
};
/** Original command and uncommitted lifecycle events held while command-before is unresolved. */
export type PendingCommandContinuation =
  | { schemaVersion: 1; kind?: 'command-before-lifecycle'; envelope: import('./commands.js').CommandEnvelope; events: readonly import('./commands.js').DomainEvent[] }
  | { schemaVersion: 1; kind: 'team-overflow'; envelope: import('./commands.js').CommandEnvelope; events: readonly import('./commands.js').DomainEvent[]; rollbackState: import('./state.js').GameState; policy: { moduleId: string; policyId: string }; candidateIds: readonly string[]; requiredSelectionCount: number; optionCandidates: Readonly<Record<string, readonly string[]>>; registry: LifecycleRegistrySnapshot }
  | { schemaVersion: 1; kind: 'combat-reward'; continuationId: string; envelope: import('./commands.js').CommandEnvelope; rollbackState: import('./state.js').GameState; events: readonly import('./commands.js').DomainEvent[]; factStart: number; evaluation: import('./combat-reward.js').CombatRewardEvaluation; policyIndex: number; step: 'resume-policy-effect' | 'dispatch-next-policy'; context: EffectContext; registry: LifecycleRegistrySnapshot };
/** Serializable cursor for a command whose reducer has completed but post-command lifecycle work is pending. */
export type PendingPostCommandContinuation = {
  schemaVersion: 1;
  continuationId: string;
  envelope: import('./commands.js').CommandEnvelope;
  rollbackState: import('./state.js').GameState;
  facts: readonly import('./commands.js').DomainEvent[];
  factIndex: number;
  boundary: 'event-before' | 'event-after' | 'command-after';
  step: 'dispatch-boundary' | 'resume-boundary';
  events: readonly import('./commands.js').DomainEvent[];
  payload: import('./lifecycle.js').LifecyclePayload;
  context: EffectContext;
  registry: LifecycleRegistrySnapshot;
};
export type EffectExecutionState = { pendingChoice?: PendingEffectChoice; pendingLifecycle?: PendingLifecycleDispatch; pendingCommand?: PendingCommandContinuation; pendingPostCommand?: PendingPostCommandContinuation };
/** Registry skeleton: card content is not registered in this PR. */
export type EffectTrigger = { schemaVersion: 1; triggerId: string; eventType: string; effect: EffectDefinition; priority?: number };
export type ContinuousEffect = { schemaVersion: 1; continuousId: string; source: EffectCardRef; duration: 'while-source-present' | 'until-rest' | 'this-turn' | 'this-combat'; effect: EffectDefinition };
export type ReplacementEffect = { schemaVersion: 1; replacementId: string; eventType: string; effect: EffectDefinition; priority?: number };
export type EffectRegistry = { triggers: readonly EffectTrigger[]; continuous: readonly ContinuousEffect[]; replacements: readonly ReplacementEffect[]; orderingPolicy?: 'explicit-priority' };

const nonEmpty = z.string().trim().min(1);
const playerRefSchema: z.ZodType<EffectPlayerRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('controller') }).strict(),
  z.object({ kind: z.literal('context-player'), key: nonEmpty }).strict(),
  z.object({ kind: z.literal('player-id'), playerId: nonEmpty }).strict()
]);
const cardRefSchema: z.ZodType<EffectCardRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('context-card'), key: nonEmpty }).strict(),
  z.object({ kind: z.literal('card-instance'), cardInstanceId: nonEmpty }).strict()
]);
const locationSchema: z.ZodType<EffectCardLocation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player-zone'), player: playerRefSchema, zone: z.enum(['drawPile', 'hand', 'discardPile', 'playArea']) }).strict(),
  z.object({ kind: z.literal('party'), player: playerRefSchema, position: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('equipment'), player: playerRefSchema, partyPosition: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty }).strict(),
  z.object({ kind: z.literal('removed') }).strict()
]);
const conditionSchema: z.ZodType<EffectCondition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('has-card-at'), card: cardRefSchema, location: locationSchema }).strict()
]);
const valueTargetSchema: z.ZodType<EffectValueTarget> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('turn-purchase-bonus'), player: playerRefSchema }).strict(),
  z.object({ kind: z.literal('turn-combat-bonus'), player: playerRefSchema }).strict(),
  z.object({ kind: z.literal('player-counter'), player: playerRefSchema, resourceId: nonEmpty }).strict()
]);
const rewardSchema: z.ZodType<CombatReward> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draw'), count: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('purchase-bonus'), amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('combat-bonus'), amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('counter'), resourceId: nonEmpty, amount: z.number().finite() }).strict()
]);
const policyRefSchema = z.object({ moduleId: nonEmpty, policyId: nonEmpty }).strict();
const uniqueOptions = <T extends { id: string }>(values: readonly T[]): boolean => new Set(values.map(({ id }) => id)).size === values.length;

export const EffectNodeSchema = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequence'), effects: z.array(EffectNodeSchema).min(1) }).strict(),
  z.object({ kind: z.literal('conditional'), condition: conditionSchema, whenTrue: EffectNodeSchema, whenFalse: EffectNodeSchema.optional() }).strict(),
  z.object({ kind: z.literal('choice'), choiceId: nonEmpty, actor: playerRefSchema, options: z.array(z.object({ id: nonEmpty, effect: EffectNodeSchema }).strict()).min(1).refine(uniqueOptions, 'Choice option IDs must be unique.') }).strict(),
  z.object({ kind: z.literal('random'), randomId: nonEmpty, outcomes: z.array(z.object({ id: nonEmpty, effect: EffectNodeSchema }).strict()).min(1).refine(uniqueOptions, 'Random outcome IDs must be unique.') }).strict(),
  z.object({ kind: z.literal('move-card'), card: cardRefSchema, from: locationSchema, to: locationSchema, position: z.union([z.enum(['top', 'bottom']), z.number().finite().int().nonnegative()]).optional(), permission: z.enum(['controller-only', 'system']).optional(), transferOwnership: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('draw'), player: playerRefSchema, count: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('discard-card'), card: cardRefSchema, from: locationSchema, permission: z.enum(['controller-only', 'system']).optional() }).strict(),
  z.object({ kind: z.literal('remove-from-game'), card: cardRefSchema, from: locationSchema, permission: z.enum(['controller-only', 'system']).optional() }).strict(),
  z.object({ kind: z.literal('modify-value'), target: valueTargetSchema, amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('grant-combat-reward'), recipient: playerRefSchema, rewards: z.array(rewardSchema).min(1) }).strict(),
  z.object({ kind: z.literal('refresh-supply-row'), refreshPolicyId: nonEmpty }).strict(),
  z.object({ kind: z.literal('create-enemy-encounter'), encounterId: nonEmpty, encounterKind: nonEmpty, rulesModuleId: nonEmpty, policy: policyRefSchema, moduleState: z.record(z.unknown()).optional() }).strict(),
  z.object({ kind: z.literal('create-enemy-target'), targetId: nonEmpty, encounterId: nonEmpty, card: cardRefSchema, from: locationSchema, targetKind: nonEmpty, partKey: nonEmpty.optional(), health: z.object({ current: z.number().finite().int().nonnegative(), max: z.number().finite().int().nonnegative() }).refine(({ current, max }) => current <= max).optional(), moduleState: z.record(z.unknown()).optional() }).strict(),
  z.object({ kind: z.literal('attach-card-to-enemy-target'), targetId: nonEmpty, card: cardRefSchema, from: locationSchema, position: z.enum(['top', 'bottom']).optional() }).strict(),
  z.object({ kind: z.literal('damage-enemy-target'), targetId: nonEmpty, amount: z.number().finite().int().nonnegative(), policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('defeat-enemy-target'), targetId: nonEmpty, policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('remove-enemy-target'), targetId: nonEmpty, policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('finish-enemy-encounter'), encounterId: nonEmpty, policy: policyRefSchema }).strict()
] as const)) as unknown as z.ZodType<EffectNode>;
export const EffectDefinitionSchema: z.ZodType<EffectDefinition> = z.object({ schemaVersion: z.literal(1), effectId: nonEmpty, body: EffectNodeSchema }).strict();

export function validateEffectDefinition(effect: EffectDefinition): string[] {
  if (!isFiniteJsonValue(effect)) return ['Effect definition must contain finite, acyclic, plain JSON data only.'];
  const parsed = EffectDefinitionSchema.safeParse(effect);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
}
