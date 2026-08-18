import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';

/** Versioned, JSON-only effect language. It carries no card presentation data. */
export type EffectPlayerRef = { kind: 'controller' } | { kind: 'context-player'; key: string } | { kind: 'player-id'; playerId: string };
export type EffectCardRef = { kind: 'context-card'; key: string } | { kind: 'card-instance'; cardInstanceId: string };
export type PlayerZoneName = 'drawPile' | 'hand' | 'discardPile' | 'playArea';
export type EffectConcreteCardLocation = { kind: 'player-zone'; player: EffectPlayerRef; zone: PlayerZoneName } | { kind: 'party'; player: EffectPlayerRef; position: number } | { kind: 'equipment'; player: EffectPlayerRef; partyPosition: number } | { kind: 'shared-zone'; zoneId: string } | { kind: 'removed' };
export type EffectCardLocation = EffectConcreteCardLocation | { kind: 'context-location'; key: string };
export type EffectSelectableCardLocation = { kind: 'player-zone'; player: EffectPlayerRef; zone: Exclude<PlayerZoneName, 'drawPile'> } | { kind: 'party'; player: EffectPlayerRef } | { kind: 'shared-zone'; zoneId: string };
export type EffectSelectableCardSource = EffectSelectableCardLocation | { kind: 'one-of'; locations: readonly EffectSelectableCardLocation[] };
export type EffectCardPredicate =
  | { kind: 'definition-type-in'; values: readonly string[] }
  | { kind: 'definition-id-in'; values: readonly string[] }
  | { kind: 'definition-cost-at-most'; value: number }
  | { kind: 'tag-in'; values: readonly string[] }
  | { kind: 'tag-prefix'; value: string }
  | { kind: 'all'; predicates: readonly EffectCardPredicate[] }
  | { kind: 'any'; predicates: readonly EffectCardPredicate[] }
  | { kind: 'not'; predicate: EffectCardPredicate };
export const EFFECT_CARD_PREDICATE_LIMITS = {
  maxDepth: 16,
  maxNodes: 64,
  maxBranchesPerNode: 16,
  maxValuesPerNode: 32,
  maxTotalValues: 128,
} as const;
export type EffectCondition = { kind: 'always'; value: boolean } | { kind: 'has-card-at'; card: EffectCardRef; location: EffectCardLocation };
export type EffectNumberExpression = { kind: 'party-distinct-tag-count'; player: EffectPlayerRef; tagPrefix: string };
export type EffectNumberValue = number | EffectNumberExpression;
export type EffectValueTarget = { kind: 'turn-purchase-bonus'; player: EffectPlayerRef } | { kind: 'turn-combat-bonus'; player: EffectPlayerRef } | { kind: 'player-counter'; player: EffectPlayerRef; resourceId: string };
export type CombatReward = { kind: 'draw'; count: number } | { kind: 'purchase-bonus'; amount: number } | { kind: 'combat-bonus'; amount: number } | { kind: 'counter'; resourceId: string; amount: number };
export type EffectNode =
  | { kind: 'sequence'; effects: readonly EffectNode[] }
  | { kind: 'conditional'; condition: EffectCondition; whenTrue: EffectNode; whenFalse?: EffectNode }
  | { kind: 'choice'; choiceId: string; decisionKind?: import('./state.js').PlayerDecisionKind; actor: EffectPlayerRef; options: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'choose-card'; choiceId: string; decisionKind?: import('./state.js').PlayerDecisionKind; actor: EffectPlayerRef; from: EffectSelectableCardSource; predicate?: EffectCardPredicate; selectedCardKey: string; selectedLocationKey?: string; skipOptionId?: string; zeroCandidateBehavior?: 'skip'; zeroCandidateEffect?: EffectNode; effect: EffectNode }
  | { kind: 'random'; randomId: string; outcomes: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'roll-die'; moduleId: string; diceId: string; outcomes: readonly { face: number; effect: EffectNode }[] }
  | { kind: 'request-counter-consent'; requestId: string; policy: import('./counter-consent.js').CounterConsentPolicyRef; counterOwner: EffectPlayerRef; outcomes: { accepted: EffectNode; declined: EffectNode; cancelled: EffectNode; expired: EffectNode } }
  | { kind: 'move-card'; card: EffectCardRef; from: EffectCardLocation; to: EffectCardLocation; position?: 'top' | 'bottom' | number; permission?: 'controller-only' | 'system'; transferOwnership?: boolean }
  | { kind: 'draw'; player: EffectPlayerRef; count: EffectNumberValue }
  | { kind: 'draw-shared-deck'; sourceZoneId: string; player: EffectPlayerRef; destination: 'hand' | 'discardPile'; count: number }
  | { kind: 'mark-combat-failed'; reasonCode: string }
  | { kind: 'discard-card'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system' }
  | { kind: 'remove-from-game'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system'; attachedEquipmentDisposition?: 'discard' }
  | { kind: 'modify-value'; target: EffectValueTarget; amount: number }
  | { kind: 'grant-combat-reward'; recipient: EffectPlayerRef; rewards: readonly CombatReward[] }
  | { kind: 'refresh-supply-row'; refreshPolicyId: string }
  | { kind: 'enforce-team-capacity'; policyId: string }
  | { kind: 'create-enemy-encounter'; encounterId: string; encounterKind: string; rulesModuleId: string; policy: { moduleId: string; policyId: string }; moduleState?: Record<string, unknown> }
  | { kind: 'create-enemy-target'; targetId: string; encounterId: string; card: EffectCardRef; from: EffectCardLocation; targetKind: string; partKey?: string; health?: { current: number; max: number }; moduleState?: Record<string, unknown> }
  | { kind: 'attach-card-to-enemy-target'; targetId: string; card: EffectCardRef; from: EffectCardLocation; position?: 'top' | 'bottom' }
  | { kind: 'damage-enemy-target'; targetId: string; amount: number; policy: { moduleId: string; policyId: string } }
  | { kind: 'defeat-enemy-target'; targetId: string; policy: { moduleId: string; policyId: string } }
  | { kind: 'remove-enemy-target'; targetId: string; policy: { moduleId: string; policyId: string } }
  | { kind: 'finish-enemy-encounter'; encounterId: string; policy: { moduleId: string; policyId: string } };
export type EffectDefinition = { schemaVersion: 1; effectId: string; body: EffectNode };
export type EffectContext = { controllerId: string; cardRefs?: Readonly<Record<string, string>> | undefined; playerRefs?: Readonly<Record<string, string>> | undefined; locationRefs?: Readonly<Record<string, EffectConcreteCardLocation>> | undefined };
export type PendingEffectChoice = { schemaVersion: 1; executionId: string; choiceId: string; decisionKind?: import('./state.js').PlayerDecisionKind; actorId: string; options: readonly { id: string; effect: EffectNode; context?: EffectContext }[]; remaining: readonly EffectNode[]; context: EffectContext; source?: EffectSelectableCardSource };
export type PendingCounterConsent = {
  schemaVersion: 1;
  executionId: string;
  requestId: string;
  policy: import('./counter-consent.js').CounterConsentPolicyRef;
  counterOwnerId: string;
  requesterId: string;
  requiredActorIds: readonly string[];
  acceptedActorIds: readonly string[];
  status: 'pending';
  outcomes: { accepted: EffectNode; declined: EffectNode; cancelled: EffectNode; expired: EffectNode };
  remaining: readonly EffectNode[];
  context: EffectContext;
  registry: import('./counter-consent.js').CounterConsentRegistryFingerprint;
};
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
  | { schemaVersion: 1; kind?: 'command-before-lifecycle'; envelope: import('./commands.js').CommandEnvelope; events: readonly import('./commands.js').DomainEvent[]; resolutionEnvelopes?: readonly import('./commands.js').CommandEnvelope[] }
  | { schemaVersion: 1; kind: 'phase-transition'; envelope: import('./commands.js').CommandEnvelope & { command: Extract<import('./commands.js').GameCommand, { type: 'END_PHASE' }> }; resolutionEnvelopes: readonly import('./commands.js').CommandEnvelope[]; events: readonly import('./commands.js').DomainEvent[]; rollbackState: import('./state.js').GameState; factStart: number; cursor: 'after-phase-end' | 'complete-nonrest' | 'after-turn-end' | 'complete-game-end' | 'after-turn-start' | 'complete-turn-start' }
  | { schemaVersion: 1; kind: 'team-overflow'; envelope: import('./commands.js').CommandEnvelope; events: readonly import('./commands.js').DomainEvent[]; rollbackState: import('./state.js').GameState; policy: { moduleId: string; policyId: string }; candidateIds: readonly string[]; requiredSelectionCount: number; optionCandidates: Readonly<Record<string, readonly string[]>>; registry: LifecycleRegistrySnapshot }
  | { schemaVersion: 1; kind: 'card-use-effect'; continuationId: string; envelope: import('./commands.js').CommandEnvelope; resolutionEnvelopes: readonly import('./commands.js').CommandEnvelope[]; rollbackState: import('./state.js').GameState; events: readonly import('./commands.js').DomainEvent[]; factStart: number; context: EffectContext; registry: LifecycleRegistrySnapshot }
  | { schemaVersion: 1; kind: 'combat-reward'; continuationId: string; envelope: import('./commands.js').CommandEnvelope; resolutionEnvelopes: readonly import('./commands.js').CommandEnvelope[]; rollbackState: import('./state.js').GameState; events: readonly import('./commands.js').DomainEvent[]; factStart: number; evaluation: import('./combat-reward.js').CombatRewardEvaluation; policyIndex: number; step: 'resume-policy-effect' | 'dispatch-next-policy'; context: EffectContext; registry: LifecycleRegistrySnapshot };
/** Serializable cursor for a command whose reducer has completed but post-command lifecycle work is pending. */
export type PendingPostCommandContinuation = {
  schemaVersion: 1;
  continuationId: string;
  envelope: import('./commands.js').CommandEnvelope;
  resolutionEnvelopes?: readonly import('./commands.js').CommandEnvelope[];
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
export type EffectExecutionState = { pendingChoice?: PendingEffectChoice; pendingCounterConsent?: PendingCounterConsent; pendingLifecycle?: PendingLifecycleDispatch; pendingCommand?: PendingCommandContinuation; pendingPostCommand?: PendingPostCommandContinuation };
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
export const EffectConcreteCardLocationSchema: z.ZodType<EffectConcreteCardLocation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player-zone'), player: playerRefSchema, zone: z.enum(['drawPile', 'hand', 'discardPile', 'playArea']) }).strict(),
  z.object({ kind: z.literal('party'), player: playerRefSchema, position: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('equipment'), player: playerRefSchema, partyPosition: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty }).strict(),
  z.object({ kind: z.literal('removed') }).strict()
]);
const locationSchema: z.ZodType<EffectCardLocation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player-zone'), player: playerRefSchema, zone: z.enum(['drawPile', 'hand', 'discardPile', 'playArea']) }).strict(),
  z.object({ kind: z.literal('party'), player: playerRefSchema, position: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('equipment'), player: playerRefSchema, partyPosition: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty }).strict(),
  z.object({ kind: z.literal('removed') }).strict(),
  z.object({ kind: z.literal('context-location'), key: nonEmpty }).strict(),
]);
export const EffectSelectableCardLocationSchema: z.ZodType<EffectSelectableCardLocation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player-zone'), player: playerRefSchema, zone: z.enum(['hand', 'discardPile', 'playArea']) }).strict(),
  z.object({ kind: z.literal('party'), player: playerRefSchema }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty }).strict(),
]);
export const EffectSelectableCardSourceSchema: z.ZodType<EffectSelectableCardSource> = z.union([
  EffectSelectableCardLocationSchema,
  z.object({ kind: z.literal('one-of'), locations: z.array(EffectSelectableCardLocationSchema).min(1).max(8).refine((locations) => new Set(locations.map((location) => JSON.stringify(location))).size === locations.length, 'Selectable card locations must be unique.') }).strict(),
]);
export const EffectContextSchema: z.ZodType<EffectContext> = z.object({
  controllerId: nonEmpty,
  cardRefs: z.record(nonEmpty).optional(),
  playerRefs: z.record(nonEmpty).optional(),
  locationRefs: z.record(EffectConcreteCardLocationSchema).optional(),
}).strict();
const canonicalPredicateValue = z.string().min(1).refine((value) => value === value.trim(), 'Predicate values must not have leading or trailing whitespace.');
const numberValueSchema: z.ZodType<EffectNumberValue> = z.union([
  z.number().finite().int().nonnegative(),
  z.object({ kind: z.literal('party-distinct-tag-count'), player: playerRefSchema, tagPrefix: canonicalPredicateValue }).strict(),
]);
const uniqueNonEmptyValues = z.array(canonicalPredicateValue).min(1).max(EFFECT_CARD_PREDICATE_LIMITS.maxValuesPerNode).refine((values) => new Set(values).size === values.length, 'Predicate values must be unique.');
const cardPredicateSchema: z.ZodType<EffectCardPredicate> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definition-type-in'), values: uniqueNonEmptyValues }).strict(),
  z.object({ kind: z.literal('definition-id-in'), values: uniqueNonEmptyValues }).strict(),
  z.object({ kind: z.literal('definition-cost-at-most'), value: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('tag-in'), values: uniqueNonEmptyValues }).strict(),
  z.object({ kind: z.literal('tag-prefix'), value: nonEmpty }).strict(),
  z.object({ kind: z.literal('all'), predicates: z.array(cardPredicateSchema).min(1).max(EFFECT_CARD_PREDICATE_LIMITS.maxBranchesPerNode) }).strict(),
  z.object({ kind: z.literal('any'), predicates: z.array(cardPredicateSchema).min(1).max(EFFECT_CARD_PREDICATE_LIMITS.maxBranchesPerNode) }).strict(),
  z.object({ kind: z.literal('not'), predicate: cardPredicateSchema }).strict(),
] as const)) as unknown as z.ZodType<EffectCardPredicate>;
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
const decisionKindSchema = z.enum(['choose-effect-option', 'discard-card', 'remove-card', 'recover-card', 'choose-market-card', 'choose-enemy-target', 'choose-party-member', 'draft-card', 'transfer-card']);
const chooseCardSchema = z.object({ kind: z.literal('choose-card'), choiceId: nonEmpty, decisionKind: decisionKindSchema.optional(), actor: playerRefSchema, from: EffectSelectableCardSourceSchema, predicate: cardPredicateSchema.optional(), selectedCardKey: nonEmpty, selectedLocationKey: nonEmpty.optional(), skipOptionId: nonEmpty.optional(), zeroCandidateBehavior: z.literal('skip').optional(), zeroCandidateEffect: z.lazy(() => EffectNodeSchema).optional(), effect: z.lazy(() => EffectNodeSchema) }).strict();

export const EffectNodeSchema = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequence'), effects: z.array(EffectNodeSchema).min(1) }).strict(),
  z.object({ kind: z.literal('conditional'), condition: conditionSchema, whenTrue: EffectNodeSchema, whenFalse: EffectNodeSchema.optional() }).strict(),
  z.object({ kind: z.literal('choice'), choiceId: nonEmpty, decisionKind: decisionKindSchema.optional(), actor: playerRefSchema, options: z.array(z.object({ id: nonEmpty, effect: EffectNodeSchema }).strict()).min(1).refine(uniqueOptions, 'Choice option IDs must be unique.') }).strict(),
  chooseCardSchema,
  z.object({ kind: z.literal('random'), randomId: nonEmpty, outcomes: z.array(z.object({ id: nonEmpty, effect: EffectNodeSchema }).strict()).min(1).refine(uniqueOptions, 'Random outcome IDs must be unique.') }).strict(),
  z.object({ kind: z.literal('roll-die'), moduleId: nonEmpty, diceId: nonEmpty, outcomes: z.array(z.object({ face: z.number().finite().int().positive(), effect: EffectNodeSchema }).strict()).min(1).refine((values) => new Set(values.map(({ face }) => face)).size === values.length, 'Die faces must be unique.') }).strict(),
  z.object({ kind: z.literal('request-counter-consent'), requestId: nonEmpty, policy: policyRefSchema, counterOwner: playerRefSchema, outcomes: z.object({ accepted: EffectNodeSchema, declined: EffectNodeSchema, cancelled: EffectNodeSchema, expired: EffectNodeSchema }).strict() }).strict(),
  z.object({ kind: z.literal('move-card'), card: cardRefSchema, from: locationSchema, to: locationSchema, position: z.union([z.enum(['top', 'bottom']), z.number().finite().int().nonnegative()]).optional(), permission: z.enum(['controller-only', 'system']).optional(), transferOwnership: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('draw'), player: playerRefSchema, count: numberValueSchema }).strict(),
  z.object({ kind: z.literal('draw-shared-deck'), sourceZoneId: nonEmpty, player: playerRefSchema, destination: z.enum(['hand', 'discardPile']), count: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('mark-combat-failed'), reasonCode: nonEmpty }).strict(),
  z.object({ kind: z.literal('discard-card'), card: cardRefSchema, from: locationSchema, permission: z.enum(['controller-only', 'system']).optional() }).strict(),
  z.object({ kind: z.literal('remove-from-game'), card: cardRefSchema, from: locationSchema, permission: z.enum(['controller-only', 'system']).optional(), attachedEquipmentDisposition: z.literal('discard').optional() }).strict(),
  z.object({ kind: z.literal('modify-value'), target: valueTargetSchema, amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('grant-combat-reward'), recipient: playerRefSchema, rewards: z.array(rewardSchema).min(1) }).strict(),
  z.object({ kind: z.literal('refresh-supply-row'), refreshPolicyId: nonEmpty }).strict(),
  z.object({ kind: z.literal('enforce-team-capacity'), policyId: nonEmpty }).strict(),
  z.object({ kind: z.literal('create-enemy-encounter'), encounterId: nonEmpty, encounterKind: nonEmpty, rulesModuleId: nonEmpty, policy: policyRefSchema, moduleState: z.record(z.unknown()).optional() }).strict(),
  z.object({ kind: z.literal('create-enemy-target'), targetId: nonEmpty, encounterId: nonEmpty, card: cardRefSchema, from: locationSchema, targetKind: nonEmpty, partKey: nonEmpty.optional(), health: z.object({ current: z.number().finite().int().nonnegative(), max: z.number().finite().int().nonnegative() }).refine(({ current, max }) => current <= max).optional(), moduleState: z.record(z.unknown()).optional() }).strict(),
  z.object({ kind: z.literal('attach-card-to-enemy-target'), targetId: nonEmpty, card: cardRefSchema, from: locationSchema, position: z.enum(['top', 'bottom']).optional() }).strict(),
  z.object({ kind: z.literal('damage-enemy-target'), targetId: nonEmpty, amount: z.number().finite().int().nonnegative(), policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('defeat-enemy-target'), targetId: nonEmpty, policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('remove-enemy-target'), targetId: nonEmpty, policy: policyRefSchema }).strict(),
  z.object({ kind: z.literal('finish-enemy-encounter'), encounterId: nonEmpty, policy: policyRefSchema }).strict()
] as const)) as unknown as z.ZodType<EffectNode>;
export const EffectDefinitionSchema: z.ZodType<EffectDefinition> = z.object({ schemaVersion: z.literal(1), effectId: nonEmpty, body: EffectNodeSchema }).strict();

const objectValue = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Iterative preflight shared by registry validation and runtime candidate evaluation. */
export function validateEffectCardPredicate(predicate: unknown): string[] {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: predicate, depth: 1 }];
  let nodes = 0;
  let totalValues = 0;
  while (stack.length) {
    const current = stack.pop()!;
    const entry = objectValue(current.value);
    if (!entry) continue;
    nodes += 1;
    if (current.depth > EFFECT_CARD_PREDICATE_LIMITS.maxDepth) return [`Effect card predicate exceeds maximum depth of ${EFFECT_CARD_PREDICATE_LIMITS.maxDepth}.`];
    if (nodes > EFFECT_CARD_PREDICATE_LIMITS.maxNodes) return [`Effect card predicate exceeds maximum node count of ${EFFECT_CARD_PREDICATE_LIMITS.maxNodes}.`];
    if (entry.kind === 'definition-type-in' || entry.kind === 'definition-id-in' || entry.kind === 'tag-in') {
      if (!Array.isArray(entry.values)) continue;
      if (entry.values.length > EFFECT_CARD_PREDICATE_LIMITS.maxValuesPerNode) return [`Effect card predicate exceeds maximum values per node of ${EFFECT_CARD_PREDICATE_LIMITS.maxValuesPerNode}.`];
      totalValues += entry.values.length;
      if (totalValues > EFFECT_CARD_PREDICATE_LIMITS.maxTotalValues) return [`Effect card predicate exceeds maximum total value count of ${EFFECT_CARD_PREDICATE_LIMITS.maxTotalValues}.`];
      if (entry.values.some((value) => typeof value === 'string' && value !== value.trim())) return ['Predicate values must not have leading or trailing whitespace.'];
      continue;
    }
    if (entry.kind === 'tag-prefix') {
      if (typeof entry.value === 'string' && entry.value !== entry.value.trim()) return ['Predicate tag prefix must not have leading or trailing whitespace.'];
      continue;
    }
    if (entry.kind === 'all' || entry.kind === 'any') {
      if (!Array.isArray(entry.predicates)) continue;
      if (entry.predicates.length > EFFECT_CARD_PREDICATE_LIMITS.maxBranchesPerNode) return [`Effect card predicate exceeds maximum branch count of ${EFFECT_CARD_PREDICATE_LIMITS.maxBranchesPerNode}.`];
      for (const child of entry.predicates) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (entry.kind === 'not') stack.push({ value: entry.predicate, depth: current.depth + 1 });
  }
  return [];
}

function validateEffectPredicateBudgets(effect: EffectDefinition): string[] {
  const queue: unknown[] = [effect.body];
  while (queue.length) {
    const node = objectValue(queue.pop());
    if (!node) continue;
    if (node.kind === 'choose-card') {
      if (node.zeroCandidateBehavior && node.zeroCandidateEffect) return ['Choose-card may declare only one zero-candidate outcome.'];
      const source = objectValue(node.from);
      const locations = source?.kind === 'one-of' && Array.isArray(source.locations) ? source.locations : [node.from];
      if (locations.some((location) => objectValue(location)?.kind === 'party') && (typeof node.selectedLocationKey !== 'string' || !node.selectedLocationKey.trim())) return ['Party card choices require selectedLocationKey.'];
      if (node.predicate !== undefined) {
        const errors = validateEffectCardPredicate(node.predicate);
        if (errors.length) return errors;
      }
      queue.push(node.effect, node.zeroCandidateEffect);
      continue;
    }
    if (node.kind === 'sequence' && Array.isArray(node.effects)) queue.push(...node.effects);
    else if (node.kind === 'conditional') queue.push(node.whenTrue, node.whenFalse);
    else if ((node.kind === 'choice' || node.kind === 'random' || node.kind === 'roll-die') && Array.isArray(node.options ?? node.outcomes)) {
      const branches = (node.options ?? node.outcomes) as unknown[];
      for (const branch of branches) queue.push(objectValue(branch)?.effect);
    } else if (node.kind === 'request-counter-consent') {
      const outcomes = objectValue(node.outcomes);
      if (outcomes) queue.push(...Object.values(outcomes));
    }
  }
  return [];
}

export function validateEffectDefinition(effect: EffectDefinition): string[] {
  if (!isFiniteJsonValue(effect)) return ['Effect definition must contain finite, acyclic, plain JSON data only.'];
  const predicateErrors = validateEffectPredicateBudgets(effect);
  if (predicateErrors.length) return predicateErrors;
  const parsed = EffectDefinitionSchema.safeParse(effect);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
}

/** Semantic entry point for effects owned by a versioned card-use continuation. */
export function validateCardUseEffectDefinition(effect: EffectDefinition): string[] {
  return validateEffectDefinition(effect);
}
