import {
  canonicalOptionalRulesModuleComposition,
  stableJsonFingerprint,
  validateOptionalRulesModuleComposition,
  type OptionalRulesModuleComposition,
} from '@guildmaster/game-protocol';

export type ComposableRulesModule = {
  id: string;
  version: string;
  config?: Record<string, unknown>;
  composition?: OptionalRulesModuleComposition;
};

export type RulesModuleRegistryIdentity = {
  id: string;
  version: string;
  config?: Record<string, unknown>;
  compositionFingerprint?: string;
};

export function rulesModuleCompositionFingerprint(
  composition: OptionalRulesModuleComposition,
): string {
  return stableJsonFingerprint(canonicalOptionalRulesModuleComposition(composition));
}

function immutableComposition(
  composition: OptionalRulesModuleComposition,
): OptionalRulesModuleComposition {
  const canonical = canonicalOptionalRulesModuleComposition(composition);
  const dependencies = canonical.dependencies?.map((dependency) => Object.freeze({ ...dependency }));
  const conflicts = canonical.conflicts ? Object.freeze([...canonical.conflicts]) : undefined;
  return Object.freeze({
    ...canonical,
    ...(dependencies ? { dependencies: Object.freeze(dependencies) } : {}),
    ...(conflicts ? { conflicts } : {}),
  });
}

function detachedDeepFreeze<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (typeof value === 'function') return value;
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const detached: unknown[] = [];
    seen.set(value, detached);
    for (const entry of value) detached.push(detachedDeepFreeze(entry, seen));
    return Object.freeze(detached) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const detached: Record<string, unknown> = Object.create(prototype) as Record<string, unknown>;
  seen.set(value, detached);
  for (const [key, entry] of Object.entries(value)) detached[key] = detachedDeepFreeze(entry, seen);
  return Object.freeze(detached) as T;
}

/**
 * Core modules are the first tier and retain caller order for backwards
 * compatibility. Explicit optional modules are canonicalized into a later tier
 * using distinct ascending priorities, so their input array order is irrelevant.
 */
export function composeRulesModules<T extends ComposableRulesModule>(modules: readonly T[]): readonly T[] {
  for (const module of modules) {
    if (!module.composition) continue;
    const errors = validateOptionalRulesModuleComposition(module.composition);
    if (errors.length) {
      throw new Error(`Invalid optional Rules Module composition ${module.id}: ${errors.join(' ')}`);
    }
  }
  const detached = modules.map((module) => detachedDeepFreeze({
    ...module,
    ...(module.composition ? { composition: immutableComposition(module.composition) } : {}),
  }) as T);
  const byId = new Map(detached.map((module) => [module.id, module]));
  const optional = detached.filter((module) => module.composition !== undefined);

  for (const module of optional) {
    const composition = module.composition!;
    const dependencies = composition.dependencies ?? [];
    const conflicts = composition.conflicts ?? [];
    if (dependencies.some(({ moduleId }) => moduleId === module.id)) {
      throw new Error(`Optional Rules Module ${module.id} cannot depend on itself.`);
    }
    if (conflicts.includes(module.id)) {
      throw new Error(`Optional Rules Module ${module.id} cannot conflict with itself.`);
    }
    for (const dependency of dependencies) {
      const active = byId.get(dependency.moduleId);
      if (!active) {
        throw new Error(`Missing Rules Module dependency: ${module.id} -> ${dependency.moduleId}.`);
      }
      if (active.version !== dependency.version) {
        throw new Error(`Rules Module dependency version mismatch: ${module.id} requires ${dependency.moduleId}@${dependency.version}, received ${active.version}.`);
      }
      if (active.composition && active.composition.priority >= composition.priority) {
        throw new Error(`Rules Module dependency order mismatch: ${dependency.moduleId} must have a lower optional priority than ${module.id}.`);
      }
    }
    for (const conflict of conflicts) {
      if (byId.has(conflict)) {
        throw new Error(`Conflicting Rules Modules: ${module.id} and ${conflict}.`);
      }
    }
  }

  const priorities = new Map<number, string>();
  for (const module of optional) {
    const priority = module.composition!.priority;
    const existing = priorities.get(priority);
    if (existing) {
      throw new Error(`ORDER_POLICY_REQUIRED: Optional Rules Modules ${existing} and ${module.id} share priority ${priority}.`);
    }
    priorities.set(priority, module.id);
  }

  const core = detached.filter((module) => module.composition === undefined);
  return Object.freeze([
    ...core,
    ...optional.sort((left, right) => left.composition!.priority - right.composition!.priority),
  ]);
}

export function rulesModuleRegistryIdentity(
  module: ComposableRulesModule,
): RulesModuleRegistryIdentity {
  return {
    id: module.id,
    version: module.version,
    ...(module.config ? { config: module.config } : {}),
    ...(module.composition
      ? { compositionFingerprint: rulesModuleCompositionFingerprint(module.composition) }
      : {}),
  };
}
