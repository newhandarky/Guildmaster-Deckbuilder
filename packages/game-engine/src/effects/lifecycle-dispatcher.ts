import type {
  DomainEvent,
  EffectContext,
  GameState,
  LifecycleHook,
  LifecycleHookRef,
  LifecyclePayload,
  LifecycleRegistrySnapshot,
  PendingLifecycleDispatch
} from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { executeEffect, resolveEffectOrder, resumeEffectChoice, type EffectExecutionResult } from './executor.js';

export type LifecycleFailureReason = 'ORDER_POLICY_REQUIRED' | 'UNKNOWN_HOOK' | 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH';
export type LifecycleDispatchResult = {
  status: 'completed' | 'suspended' | 'unsupported' | 'failed';
  hookIds: readonly string[];
  evaluatedContinuousHookIds: readonly string[];
  events: DomainEvent[];
  effect?: EffectExecutionResult;
  reason?: LifecycleFailureReason;
  error?: string;
};

const refKey = (ref: LifecycleHookRef): string => `${ref.moduleId}\u0000${ref.hookId}`;
const hookRef = (hook: LifecycleHook): LifecycleHookRef => ({ moduleId: hook.moduleId, hookId: hook.hookId });
const registrySnapshot = (state: GameState, ruleset: Ruleset): LifecycleRegistrySnapshot => ({
  rulesetVersion: state.rulesetVersion,
  modules: ruleset.modules.map(({ id, version }) => ({ id, version }))
});
const active = (hook: LifecycleHook, state: GameState): boolean => !hook.activation || hook.activation.kind === 'always' || (state.moduleState[hook.moduleId] as Record<string, unknown> | undefined)?.[hook.activation.key] === hook.activation.value;
const findHook = (ruleset: Ruleset, ref: LifecycleHookRef): LifecycleHook | undefined => ruleset.modules.find((module) => module.id === ref.moduleId)?.lifecycleHooks?.find((hook) => hook.hookId === ref.hookId);
const fail = (reason: LifecycleFailureReason, hookIds: readonly string[], evaluatedContinuousHookIds: readonly string[], error: string): LifecycleDispatchResult => ({ status: reason === 'ORDER_POLICY_REQUIRED' ? 'unsupported' : 'failed', hookIds, evaluatedContinuousHookIds, events: [], reason, error });

function validateRegistry(registry: LifecycleRegistrySnapshot, state: GameState, ruleset: Ruleset): { reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH'; error: string } | undefined {
  if (state.rulesetVersion !== registry.rulesetVersion) return { reason: 'REGISTRY_VERSION_MISMATCH', error: `Lifecycle ruleset version mismatch: expected ${registry.rulesetVersion}, received ${state.rulesetVersion}.` };
  for (const expected of registry.modules) {
    const stateModule = state.rulesModules.find((module) => module.id === expected.id);
    const rulesModule = ruleset.modules.find((module) => module.id === expected.id);
    if (!stateModule || !rulesModule) return { reason: 'UNKNOWN_MODULE', error: `Unknown lifecycle Rules Module: ${expected.id}.` };
    if (stateModule.version !== expected.version || rulesModule.version !== expected.version) return { reason: 'REGISTRY_VERSION_MISMATCH', error: `Lifecycle Rules Module version mismatch: ${expected.id}@${expected.version}.` };
  }
  const expectedSignature = registry.modules.map(({ id, version }) => `${id}@${version}`).join('|');
  const stateSignature = state.rulesModules.map(({ id, version }) => `${id}@${version}`).join('|');
  const rulesetSignature = ruleset.modules.map(({ id, version }) => `${id}@${version}`).join('|');
  if (stateSignature !== expectedSignature || rulesetSignature !== expectedSignature) return { reason: 'REGISTRY_VERSION_MISMATCH', error: 'Lifecycle Rules Module registry does not match the pending dispatch.' };
  return undefined;
}

function validateHookRefs(ruleset: Ruleset, refs: readonly LifecycleHookRef[]): { reason: 'UNKNOWN_MODULE' | 'UNKNOWN_HOOK'; error: string } | undefined {
  for (const ref of refs) {
    const module = ruleset.modules.find((candidate) => candidate.id === ref.moduleId);
    if (!module) return { reason: 'UNKNOWN_MODULE', error: `Unknown lifecycle Rules Module: ${ref.moduleId}.` };
    if (!findHook(ruleset, ref)) return { reason: 'UNKNOWN_HOOK', error: `Unknown lifecycle hook: ${ref.moduleId}/${ref.hookId}.` };
  }
  return undefined;
}

function continueHooks(state: GameState, ruleset: Ruleset, pending: PendingLifecycleDispatch, refs: readonly LifecycleHookRef[], priorEvents: DomainEvent[]): LifecycleDispatchResult {
  const next = structuredClone(state); const events = [...priorEvents];
  delete next.effectState.pendingLifecycle;
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!; const hook = findHook(ruleset, ref);
    if (!hook) { Object.assign(state, structuredClone(pending.rollbackState)); return fail('UNKNOWN_HOOK', refs.map(({ hookId }) => hookId), [], `Unknown lifecycle hook: ${ref.moduleId}/${ref.hookId}.`); }
    const effect = executeEffect(next, ruleset, hook.effect, pending.context, `${pending.dispatchId}:${ref.moduleId}:${ref.hookId}`);
    events.push(...effect.events);
    if (effect.status === 'suspended') {
      next.effectState.pendingLifecycle = { ...pending, currentHook: ref, remainingHooks: refs.slice(index + 1) };
      Object.assign(state, next);
      return { status: 'suspended', hookIds: refs.map(({ hookId }) => hookId), evaluatedContinuousHookIds: [], events, effect };
    }
    if (effect.status !== 'completed') {
      Object.assign(state, structuredClone(pending.rollbackState));
      return { status: effect.status, hookIds: refs.map(({ hookId }) => hookId), evaluatedContinuousHookIds: [], events: [], effect, ...(effect.error ? { error: effect.error } : {}) };
    }
  }
  delete next.effectState.pendingLifecycle;
  Object.assign(state, next);
  return { status: 'completed', hookIds: refs.map(({ hookId }) => hookId), evaluatedContinuousHookIds: [], events };
}

/** Runs only serializable registry records. Continuous hooks are evaluated as boundaries but are not applied as card effects. */
export function dispatchLifecycle(state: GameState, ruleset: Ruleset, payload: LifecyclePayload, context: EffectContext): LifecycleDispatchResult {
  if (state.effectState.pendingChoice || state.effectState.pendingLifecycle) return { status: 'failed', hookIds: [], evaluatedContinuousHookIds: [], events: [], error: 'Another effect continuation is pending.' };
  const hooks = ruleset.modules.flatMap((module) => module.lifecycleHooks ?? []).filter((hook) => hook.point === payload.point && (!hook.eventType || hook.eventType === payload.eventType) && active(hook, state));
  const continuous = hooks.filter((hook) => hook.kind === 'continuous');
  const executable = hooks.filter((hook) => hook.kind !== 'continuous');
  const order = resolveEffectOrder(executable.map((hook) => ({ id: refKey(hookRef(hook)), ...(hook.priority === undefined ? {} : { priority: hook.priority }) })), 'explicit-priority');
  const continuousIds = continuous.map(({ hookId }) => hookId);
  if (order.status === 'unsupported') return fail(order.reason, [], continuousIds, 'Lifecycle hook ordering requires distinct explicit priorities.');
  const refs = order.orderedIds.map((key) => hookRef(executable.find((hook) => refKey(hookRef(hook)) === key)!));
  const registry = registrySnapshot(state, ruleset); const registryError = validateRegistry(registry, state, ruleset);
  if (registryError) return fail(registryError.reason, refs.map(({ hookId }) => hookId), continuousIds, registryError.error);
  const refError = validateHookRefs(ruleset, refs);
  if (refError) return fail(refError.reason, refs.map(({ hookId }) => hookId), continuousIds, refError.error);
  if (!refs.length) return { status: 'completed', hookIds: [], evaluatedContinuousHookIds: continuousIds, events: [] };
  const pending: PendingLifecycleDispatch = {
    schemaVersion: 1,
    dispatchId: `lifecycle:${payload.point}:${state.revision}`,
    payload: structuredClone(payload),
    context: structuredClone(context),
    currentHook: refs[0]!,
    remainingHooks: refs.slice(1),
    registry,
    rollbackState: structuredClone(state)
  };
  const result = continueHooks(state, ruleset, pending, refs, []);
  return { ...result, evaluatedContinuousHookIds: continuousIds };
}

/** Resumes the pending Effect AST choice, then continues the exact serialized lifecycle queue. */
export function resumeLifecycleChoice(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): LifecycleDispatchResult {
  const pending = state.effectState.pendingLifecycle;
  if (!pending) return { status: 'failed', hookIds: [], evaluatedContinuousHookIds: [], events: [], error: 'No pending lifecycle dispatch.' };
  const hookIds = [pending.currentHook, ...pending.remainingHooks].map(({ hookId }) => hookId);
  const registryError = validateRegistry(pending.registry, state, ruleset);
  if (registryError) return fail(registryError.reason, hookIds, [], registryError.error);
  const refError = validateHookRefs(ruleset, [pending.currentHook, ...pending.remainingHooks]);
  if (refError) return fail(refError.reason, hookIds, [], refError.error);
  const next = structuredClone(state);
  const effect = resumeEffectChoice(next, ruleset, actorId, executionId, choiceId, optionId);
  if (effect.status === 'failed' || effect.status === 'unsupported') return { status: effect.status, hookIds, evaluatedContinuousHookIds: [], events: [], effect, ...(effect.error ? { error: effect.error } : {}) };
  if (effect.status === 'suspended') { Object.assign(state, next); return { status: 'suspended', hookIds, evaluatedContinuousHookIds: [], events: effect.events, effect }; }
  delete next.effectState.pendingLifecycle;
  const result = continueHooks(next, ruleset, pending, pending.remainingHooks, effect.events);
  Object.assign(state, next);
  return result;
}
