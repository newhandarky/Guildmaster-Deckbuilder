import { z } from 'zod';
import { EffectDefinitionSchema, validateEffectDefinition, type EffectDefinition, type EffectNode } from './effects.js';
import { isFiniteJsonValue } from './encounter.js';

export const lifecyclePoints = ['game-setup', 'game-start', 'turn-start', 'turn-end', 'phase-start', 'phase-end', 'command-before', 'command-after', 'event-before', 'event-after', 'game-end-evaluation'] as const;
export type LifecyclePoint = (typeof lifecyclePoints)[number];
export type LifecycleHookKind = 'trigger' | 'continuous' | 'replacement';
/** JSON-only registry record owned by a Rules Module; no executable closures. */
export type LifecycleHook = { schemaVersion: 1; hookId: string; moduleId: string; point: LifecyclePoint; kind: LifecycleHookKind; eventType?: string; effect: EffectDefinition; priority?: number; activation?: { kind: 'always' } | { kind: 'module-state-equals'; key: string; value: string | number | boolean | null } };
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
export const LifecycleHookSchema = z.object({
  schemaVersion: z.literal(1),
  hookId: nonEmpty,
  moduleId: nonEmpty,
  point: z.enum(lifecyclePoints),
  kind: z.enum(['trigger', 'continuous', 'replacement']),
  eventType: nonEmpty.optional(),
  effect: EffectDefinitionSchema,
  priority: z.number().finite().optional(),
  activation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('always') }).strict(),
    z.object({ kind: z.literal('module-state-equals'), key: nonEmpty, value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict()
  ]).optional()
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
  if (node.kind === 'choice' || node.kind === 'choose-card' || node.kind === 'request-counter-consent') return true;
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
