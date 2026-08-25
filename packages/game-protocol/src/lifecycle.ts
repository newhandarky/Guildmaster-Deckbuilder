import { z } from 'zod';
import { EffectDefinitionSchema, validateEffectDefinition, type EffectDefinition, type EffectNode } from './effects.js';
import { isFiniteJsonValue } from './encounter.js';

export const lifecyclePoints = ['game-setup', 'game-start', 'turn-start', 'turn-end', 'phase-start', 'phase-end', 'command-before', 'command-after', 'event-before', 'event-after', 'game-end-evaluation'] as const;
export type LifecyclePoint = (typeof lifecyclePoints)[number];
export type LifecycleHookKind = 'trigger' | 'continuous' | 'replacement';
export type LifecycleActivation =
  | { kind: 'always' }
  | { kind: 'module-state-equals'; key: string; value: string | number | boolean | null }
  | { kind: 'metadata-equals'; key: string; value: string | number | boolean | null }
  | { kind: 'phase-is'; phase: import('./state.js').Phase }
  | { kind: 'definition-in-actor-party'; definitionId: string }
  | { kind: 'definition-at-actor-party-position'; definitionId: string; position: number }
  | { kind: 'definition-equipped-by-actor'; definitionId: string }
  | { kind: 'definition-in-zone'; zoneId: string; definitionId: string }
  | { kind: 'zone-card-count-at-least'; zoneId: string; amount: number }
  | { kind: 'turn-fact-at-least'; fact: keyof Omit<import('./state.js').TurnFactLedger, 'schemaVersion' | 'playerId'>; amount: number }
  | { kind: 'all'; conditions: readonly LifecycleActivation[] }
  | { kind: 'any'; conditions: readonly LifecycleActivation[] }
  | { kind: 'not'; condition: LifecycleActivation };
/** JSON-only registry record owned by a Rules Module; no executable closures. */
export type LifecycleHook = { schemaVersion: 1; hookId: string; moduleId: string; point: LifecyclePoint; kind: LifecycleHookKind; eventType?: string; effect: EffectDefinition; priority?: number; activation?: LifecycleActivation };
/**
 * A content-owned, immediate event trigger resolved once for every equipped card
 * instance that is still attached to the event actor's party.
 *
 * Schema v1 ordering is intentionally two-tiered: equipment instances execute
 * first in ascending party-slot order, and then Rules Module lifecycle hooks
 * execute in their own priority domain. `priority` only orders multiple matching
 * triggers declared by the same equipment definition; it never competes with a
 * Rules Module hook priority.
 */
export type EquipmentEventTrigger = { schemaVersion: 1; triggerId: string; point: 'event-after'; eventType: string; effect: EffectDefinition; /** Scoped to matching triggers on one equipment definition. */ priority?: number };
export type LifecyclePayload = { schemaVersion: 1; point: LifecyclePoint; actorId?: string; commandType?: string; eventType?: string; phase?: string; metadata?: Record<string, string | number | boolean | null> };
const nonEmpty = z.string().trim().min(1);
const canonicalNonEmpty = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
const turnFact = z.enum(['adventurersRecruited', 'adventurersAddedToParty', 'itemsBought', 'equipmentBought', 'purchasePowerSpent', 'extraCardsDrawn', 'itemsUsed', 'bossesDefeated', 'monstersDefeated', 'marketRefreshed', 'combatResolved', 'combatSkipped']);
const LifecycleActivationSchema: z.ZodType<LifecycleActivation> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }).strict(),
  z.object({ kind: z.literal('module-state-equals'), key: canonicalNonEmpty, value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict(),
  z.object({ kind: z.literal('metadata-equals'), key: canonicalNonEmpty, value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict(),
  z.object({ kind: z.literal('phase-is'), phase: z.enum(['action1', 'combat', 'action2', 'purchase', 'rest']) }).strict(),
  z.object({ kind: z.literal('definition-in-actor-party'), definitionId: canonicalNonEmpty }).strict(),
  z.object({ kind: z.literal('definition-at-actor-party-position'), definitionId: canonicalNonEmpty, position: z.number().finite().int().positive() }).strict(),
  z.object({ kind: z.literal('definition-equipped-by-actor'), definitionId: canonicalNonEmpty }).strict(),
  z.object({ kind: z.literal('definition-in-zone'), zoneId: canonicalNonEmpty, definitionId: canonicalNonEmpty }).strict(),
  z.object({ kind: z.literal('zone-card-count-at-least'), zoneId: canonicalNonEmpty, amount: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('turn-fact-at-least'), fact: turnFact, amount: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(LifecycleActivationSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(LifecycleActivationSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: LifecycleActivationSchema }).strict(),
]));
export const LifecycleHookSchema = z.object({
  schemaVersion: z.literal(1),
  hookId: nonEmpty,
  moduleId: nonEmpty,
  point: z.enum(lifecyclePoints),
  kind: z.enum(['trigger', 'continuous', 'replacement']),
  eventType: nonEmpty.optional(),
  effect: EffectDefinitionSchema,
  priority: z.number().finite().optional(),
  activation: LifecycleActivationSchema.optional()
}).strict() as unknown as z.ZodType<LifecycleHook>;
export const EquipmentEventTriggerSchema = z.object({
  schemaVersion: z.literal(1),
  triggerId: canonicalNonEmpty,
  point: z.literal('event-after'),
  eventType: canonicalNonEmpty,
  effect: EffectDefinitionSchema,
  priority: z.number().finite().optional(),
}).strict() as unknown as z.ZodType<EquipmentEventTrigger>;

function containsSuspendingNode(node: EffectNode): boolean {
  if (node.kind === 'choice' || node.kind === 'choose-card' || node.kind === 'choose-order-player-deck-top' || node.kind === 'choose-order-player-party' || node.kind === 'repeat-discard-hand-for-combat' || node.kind === 'choose-shared-row-refresh-subset' || node.kind === 'repeat-item-use-effect' || node.kind === 'request-counter-consent') return true;
  if (node.kind === 'sequence') return node.effects.some(containsSuspendingNode);
  if (node.kind === 'conditional') return containsSuspendingNode(node.whenTrue) || Boolean(node.whenFalse && containsSuspendingNode(node.whenFalse));
  if (node.kind === 'random') return node.outcomes.some(({ effect }) => containsSuspendingNode(effect));
  if (node.kind === 'roll-die') return node.outcomes.some(({ effect }) => containsSuspendingNode(effect));
  return false;
}

export function validateEquipmentEventTrigger(trigger: EquipmentEventTrigger): string[] {
  if (!isFiniteJsonValue(trigger)) return ['Equipment event trigger must contain finite, acyclic, plain JSON-serializable data only.'];
  const parsed = EquipmentEventTriggerSchema.safeParse(trigger);
  if (!parsed.success) return parsed.error.issues.map((issue) => `Equipment event trigger invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  const errors = validateEffectDefinition(trigger.effect).map((error) => `Equipment event trigger ${trigger.triggerId}: ${error}`);
  if (containsSuspendingNode(trigger.effect.body)) errors.push(`Equipment event trigger ${trigger.triggerId} must be immediate and cannot contain choice, choose-card, or counter-consent nodes.`);
  return errors;
}
export function validateLifecycleHook(hook: LifecycleHook, moduleId: string): string[] {
  const errors: string[] = [];
  if (!isFiniteJsonValue(hook)) return ['Lifecycle hook must contain finite, acyclic, plain JSON-serializable data only.'];
  const parsed = LifecycleHookSchema.safeParse(hook);
  if (!parsed.success) return parsed.error.issues.map((issue) => `Lifecycle hook invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (hook.moduleId !== moduleId) errors.push('Lifecycle hook requires the owning module ID.');
  if (hook.kind === 'replacement' && hook.point !== 'event-before') errors.push('Replacement hooks are only valid at event-before.');
  if (hook.kind === 'trigger' && hook.point === 'event-before') errors.push('Triggered effects run after facts, never at event-before.');
  if (hook.eventType && hook.point !== 'event-before' && hook.point !== 'event-after') errors.push('Event type filters are only valid at event lifecycle points.');
  errors.push(...validateEffectDefinition(hook.effect).map((error) => `Lifecycle hook ${hook.hookId}: ${error}`));
  return errors;
}
