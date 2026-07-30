import { z } from 'zod';
import { EffectDefinitionSchema, validateEffectDefinition, type EffectDefinition } from './effects.js';
import { isFiniteJsonValue } from './encounter.js';

export const lifecyclePoints = ['game-setup', 'game-start', 'turn-start', 'turn-end', 'phase-start', 'phase-end', 'command-before', 'command-after', 'event-before', 'event-after', 'game-end-evaluation'] as const;
export type LifecyclePoint = (typeof lifecyclePoints)[number];
export type LifecycleHookKind = 'trigger' | 'continuous' | 'replacement';
/** JSON-only registry record owned by a Rules Module; no executable closures. */
export type LifecycleHook = { schemaVersion: 1; hookId: string; moduleId: string; point: LifecyclePoint; kind: LifecycleHookKind; eventType?: string; effect: EffectDefinition; priority?: number; activation?: { kind: 'always' } | { kind: 'module-state-equals'; key: string; value: string | number | boolean | null } };
export type LifecyclePayload = { schemaVersion: 1; point: LifecyclePoint; actorId?: string; commandType?: string; eventType?: string; phase?: string; metadata?: Record<string, string | number | boolean | null> };
const nonEmpty = z.string().trim().min(1);
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
