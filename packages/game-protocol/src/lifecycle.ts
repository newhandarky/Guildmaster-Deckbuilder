import { validateEffectDefinition, type EffectDefinition } from './effects.js';

export const lifecyclePoints = ['game-setup', 'game-start', 'turn-start', 'turn-end', 'phase-start', 'phase-end', 'command-before', 'command-after', 'event-before', 'event-after', 'game-end-evaluation'] as const;
export type LifecyclePoint = (typeof lifecyclePoints)[number];
export type LifecycleHookKind = 'trigger' | 'continuous' | 'replacement';
/** JSON-only registry record owned by a Rules Module; no executable closures. */
export type LifecycleHook = { schemaVersion: 1; hookId: string; moduleId: string; point: LifecyclePoint; kind: LifecycleHookKind; eventType?: string; effect: EffectDefinition; priority?: number; activation?: { kind: 'always' } | { kind: 'module-state-equals'; key: string; value: string | number | boolean | null } };
export type LifecyclePayload = { schemaVersion: 1; point: LifecyclePoint; actorId?: string; commandType?: string; eventType?: string; phase?: string; metadata?: Record<string, string | number | boolean | null> };
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.values(value as Record<string, unknown>).every(isJsonValue);
}
export function validateLifecycleHook(hook: LifecycleHook, moduleId: string): string[] {
  const errors: string[] = [];
  if (hook.schemaVersion !== 1 || hook.moduleId !== moduleId || !hook.hookId.trim()) errors.push('Lifecycle hook requires schema version, stable ID, and owning module ID.');
  if (hook.kind === 'replacement' && hook.point !== 'event-before') errors.push('Replacement hooks are only valid at event-before.');
  if (hook.kind === 'trigger' && hook.point === 'event-before') errors.push('Triggered effects run after facts, never at event-before.');
  if (hook.eventType && hook.point !== 'event-before' && hook.point !== 'event-after') errors.push('Event type filters are only valid at event lifecycle points.');
  errors.push(...validateEffectDefinition(hook.effect).map((error) => `Lifecycle hook ${hook.hookId}: ${error}`));
  if (!isJsonValue(hook)) errors.push(`Lifecycle hook ${hook.hookId} must contain JSON-serializable data only.`);
  return errors;
}
