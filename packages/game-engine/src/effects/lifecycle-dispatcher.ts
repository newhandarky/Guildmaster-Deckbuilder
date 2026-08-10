import type {
  DomainEvent,
  EffectContext,
  EquipmentEventTrigger,
  GameState,
  LifecycleHook,
  LifecycleHookRef,
  LifecyclePayload,
  LifecycleRegistrySnapshot,
  PendingLifecycleDispatch
} from '@guildmaster/game-protocol';
import { validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { getDefinition } from '../model/factories.js';
import { executeEffect, inspectEffectPreviewUncertainty, resolveEffectOrder, resumeEffectChoice, resumeEffectCounterConsent, validatePendingChoiceAgainstEffect, validatePendingCounterConsentAgainstEffect, type EffectExecutionResult, type EffectPreviewUncertainty } from './executor.js';

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
const candidateHooks = (ruleset: Ruleset, payload: LifecyclePayload): LifecycleHook[] => ruleset.modules.flatMap((module) => module.lifecycleHooks ?? []).filter((hook) => hook.point === payload.point && (!hook.eventType || hook.eventType === payload.eventType));
const matchingHooks = (state: GameState, ruleset: Ruleset, payload: LifecyclePayload): LifecycleHook[] => candidateHooks(ruleset, payload).filter((hook) => active(hook, state));
const fail = (reason: LifecycleFailureReason, hookIds: readonly string[], evaluatedContinuousHookIds: readonly string[], error: string): LifecycleDispatchResult => ({ status: reason === 'ORDER_POLICY_REQUIRED' ? 'unsupported' : 'failed', hookIds, evaluatedContinuousHookIds, events: [], reason, error });
const normalizedEffectEvents = (pending: PendingLifecycleDispatch, ref: LifecycleHookRef, events: readonly DomainEvent[], offset: number): DomainEvent[] => events.map((event, index) => ({ ...event, eventId: `${pending.dispatchId}:${ref.moduleId}:${ref.hookId}:${offset + index + 1}` }));
type ResolvedEquipmentTrigger = { cardInstanceId: string; partyPosition: number; trigger: EquipmentEventTrigger; context: EffectContext };
const equipmentTriggerId = ({ cardInstanceId, trigger }: ResolvedEquipmentTrigger): string => `equipment:${cardInstanceId}:${trigger.triggerId}`;
const normalizedEquipmentEvents = (dispatchId: string, resolved: ResolvedEquipmentTrigger, events: readonly DomainEvent[], offset: number): DomainEvent[] => events.map((event, index) => ({ ...event, eventId: `${dispatchId}:${equipmentTriggerId(resolved)}:${offset + index + 1}` }));

function matchingEquipmentTriggers(state: GameState, ruleset: Ruleset, payload: LifecyclePayload, context: EffectContext): ResolvedEquipmentTrigger[] {
  if (payload.point !== 'event-after' || !payload.eventType || !payload.actorId) return [];
  const player = state.players.find(({ id }) => id === payload.actorId);
  if (!player) return [];
  return player.party.flatMap((slot, partyPosition) => {
    if (!slot.equipmentId) return [];
    const definition = getDefinition(ruleset.registry, state, slot.equipmentId);
    const triggers = (definition.equipmentEventTriggers ?? [])
      .filter((trigger) => trigger.point === payload.point && trigger.eventType === payload.eventType)
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
    return triggers.map((trigger) => ({
      cardInstanceId: slot.equipmentId!,
      partyPosition,
      trigger,
      context: {
        ...structuredClone(context),
        controllerId: player.id,
        cardRefs: { ...structuredClone(context.cardRefs ?? {}), sourceEquipment: slot.equipmentId! },
        playerRefs: { ...structuredClone(context.playerRefs ?? {}), sourceOwner: player.id },
        locationRefs: {
          ...structuredClone(context.locationRefs ?? {}),
          sourceEquipment: { kind: 'equipment', player: { kind: 'player-id', playerId: player.id }, partyPosition },
        },
      },
    }));
  });
}

function validateRegistry(registry: LifecycleRegistrySnapshot, state: GameState, ruleset: Ruleset): { reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH'; error: string } | undefined {
  const compatibilityError = validateRulesetStateCompatibility(state, ruleset); if (compatibilityError) return { reason: 'REGISTRY_VERSION_MISMATCH', error: compatibilityError };
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
function canonicalRefs(state: GameState, ruleset: Ruleset, payload: LifecyclePayload): LifecycleHookRef[] | undefined { const hooks = ruleset.modules.flatMap((module) => module.lifecycleHooks ?? []).filter((hook) => hook.kind !== 'continuous' && hook.point === payload.point && (!hook.eventType || hook.eventType === payload.eventType) && active(hook, state)); const order = resolveEffectOrder(hooks.map((hook) => ({ id: refKey(hookRef(hook)), ...(hook.priority === undefined ? {} : { priority: hook.priority }) })), 'explicit-priority'); if (order.status !== 'ready') return undefined; return order.orderedIds.map((key) => hookRef(hooks.find((hook) => refKey(hookRef(hook)) === key)!)); }

function hookPreviewUncertainty(state: GameState, ruleset: Ruleset, hooks: readonly (LifecycleHook | undefined)[], context: EffectContext, viewerId: string): EffectPreviewUncertainty {
  if (hooks.some((hook) => !hook)) return { usesRandomness: true, observesHiddenInformation: true };
  return hooks.reduce<EffectPreviewUncertainty>((merged, hook) => {
    const value = inspectEffectPreviewUncertainty(hook!.effect.body, state, context, viewerId);
    return { usesRandomness: merged.usesRandomness || value.usesRandomness, observesHiddenInformation: merged.observesHiddenInformation || value.observesHiddenInformation };
  }, { usesRandomness: false, observesHiddenInformation: false });
}

export function inspectLifecyclePreviewUncertainty(state: GameState, ruleset: Ruleset, payload: LifecyclePayload, context: EffectContext, viewerId: string): EffectPreviewUncertainty {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  const candidates = candidateHooks(ruleset, payload).filter((hook) => hook.kind !== 'continuous');
  const hooks = matchingHooks(state, ruleset, payload).filter((hook) => hook.kind !== 'continuous');
  const equipmentUncertainty = matchingEquipmentTriggers(state, ruleset, payload, context).reduce<EffectPreviewUncertainty>((merged, resolved) => {
    const value = inspectEffectPreviewUncertainty(resolved.trigger.effect.body, state, resolved.context, viewerId);
    return { usesRandomness: merged.usesRandomness || value.usesRandomness, observesHiddenInformation: merged.observesHiddenInformation || value.observesHiddenInformation };
  }, { usesRandomness: false, observesHiddenInformation: false });
  const hookUncertainty = hookPreviewUncertainty(state, ruleset, hooks, context, viewerId);
  const uncertainty = { usesRandomness: equipmentUncertainty.usesRandomness || hookUncertainty.usesRandomness, observesHiddenInformation: equipmentUncertainty.observesHiddenInformation || hookUncertainty.observesHiddenInformation };
  return { ...uncertainty, observesHiddenInformation: uncertainty.observesHiddenInformation || candidates.some((hook) => hook.activation?.kind === 'module-state-equals') };
}

export function inspectPendingLifecyclePreviewUncertainty(state: GameState, ruleset: Ruleset, viewerId: string): EffectPreviewUncertainty {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  const pending = state.effectState.pendingLifecycle;
  if (!pending) return { usesRandomness: false, observesHiddenInformation: false };
  return hookPreviewUncertainty(state, ruleset, [pending.currentHook, ...pending.remainingHooks].map((ref) => findHook(ruleset, ref)), pending.context, viewerId);
}

function continueHooks(state: GameState, ruleset: Ruleset, pending: PendingLifecycleDispatch, refs: readonly LifecycleHookRef[], priorEvents: DomainEvent[]): LifecycleDispatchResult {
  const next = structuredClone(state); const events = [...priorEvents];
  delete next.effectState.pendingLifecycle;
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!; const hook = findHook(ruleset, ref);
    if (!hook) { Object.assign(state, structuredClone(pending.rollbackState)); return fail('UNKNOWN_HOOK', refs.map(({ hookId }) => hookId), [], `Unknown lifecycle hook: ${ref.moduleId}/${ref.hookId}.`); }
    const effect = executeEffect(next, ruleset, hook.effect, pending.context, `${pending.dispatchId}:${ref.moduleId}:${ref.hookId}`);
    events.push(...normalizedEffectEvents(pending, ref, effect.events, events.length));
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

/**
 * Runs only serializable registry records. Equipment trigger schema v1 is a
 * separate, earlier ordering tier (party slot, then definition-local priority);
 * Rules Module hooks run afterward in their existing module-priority tier.
 * Continuous hooks are evaluated as boundaries but are not applied as card effects.
 */
export function dispatchLifecycle(state: GameState, ruleset: Ruleset, payload: LifecyclePayload, context: EffectContext): LifecycleDispatchResult {
  if (state.effectState.pendingChoice || state.effectState.pendingCounterConsent || state.effectState.pendingLifecycle) return { status: 'failed', hookIds: [], evaluatedContinuousHookIds: [], events: [], error: 'Another effect continuation is pending.' };
  const hooks = matchingHooks(state, ruleset, payload);
  const continuous = hooks.filter((hook) => hook.kind === 'continuous');
  const executable = hooks.filter((hook) => hook.kind !== 'continuous');
  const equipment = matchingEquipmentTriggers(state, ruleset, payload, context);
  const order = resolveEffectOrder(executable.map((hook) => ({ id: refKey(hookRef(hook)), ...(hook.priority === undefined ? {} : { priority: hook.priority }) })), 'explicit-priority');
  const continuousIds = continuous.map(({ hookId }) => hookId);
  if (order.status === 'unsupported') return fail(order.reason, [], continuousIds, 'Lifecycle hook ordering requires distinct explicit priorities.');
  const refs = order.orderedIds.map((key) => hookRef(executable.find((hook) => refKey(hookRef(hook)) === key)!));
  const registry = registrySnapshot(state, ruleset); const registryError = validateRegistry(registry, state, ruleset);
  if (registryError) return fail(registryError.reason, refs.map(({ hookId }) => hookId), continuousIds, registryError.error);
  const refError = validateHookRefs(ruleset, refs);
  if (refError) return fail(refError.reason, refs.map(({ hookId }) => hookId), continuousIds, refError.error);
  const equipmentIds = equipment.map(equipmentTriggerId);
  const rollbackState = structuredClone(state);
  const dispatchId = `lifecycle:${payload.point}:${state.revision}:${payload.metadata?.eventId ?? payload.metadata?.commandId ?? 'boundary'}`;
  const equipmentEvents: DomainEvent[] = [];
  for (const resolved of equipment) {
    const effect = executeEffect(state, ruleset, resolved.trigger.effect, resolved.context, `${dispatchId}:${equipmentTriggerId(resolved)}`);
    equipmentEvents.push(...normalizedEquipmentEvents(dispatchId, resolved, effect.events, equipmentEvents.length));
    if (effect.status !== 'completed') {
      Object.assign(state, rollbackState);
      return { status: 'failed', hookIds: equipmentIds, evaluatedContinuousHookIds: continuousIds, events: [], effect, error: effect.error ?? 'Equipment event triggers must complete without suspension.' };
    }
  }
  if (!refs.length) return { status: 'completed', hookIds: equipmentIds, evaluatedContinuousHookIds: continuousIds, events: equipmentEvents };
  const pending: PendingLifecycleDispatch = {
    schemaVersion: 1,
    dispatchId,
    payload: structuredClone(payload),
    context: structuredClone(context),
    currentHook: refs[0]!,
    remainingHooks: refs.slice(1),
    registry,
    rollbackState
  };
  const result = continueHooks(state, ruleset, pending, refs, equipmentEvents);
  return { ...result, hookIds: [...equipmentIds, ...result.hookIds], evaluatedContinuousHookIds: continuousIds };
}

/** Resumes the pending Effect AST choice, then continues the exact serialized lifecycle queue. */
export function resumeLifecycleChoice(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): LifecycleDispatchResult {
  const pending = state.effectState.pendingLifecycle;
  if (!pending) return { status: 'failed', hookIds: [], evaluatedContinuousHookIds: [], events: [], error: 'No pending lifecycle dispatch.' };
  const hookIds = [pending.currentHook, ...pending.remainingHooks].map(({ hookId }) => hookId);
  if (pending.rollbackState.gameId !== state.gameId || JSON.stringify(pending.rollbackState.contentPacks) !== JSON.stringify(state.contentPacks) || JSON.stringify(pending.rollbackState.rulesModules) !== JSON.stringify(state.rulesModules)) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: 'Lifecycle rollback checkpoint registry does not match current state.' };
  const registryError = validateRegistry(pending.registry, state, ruleset);
  if (registryError) return fail(registryError.reason, hookIds, [], registryError.error);
  const refError = validateHookRefs(ruleset, [pending.currentHook, ...pending.remainingHooks]);
  if (refError) return fail(refError.reason, hookIds, [], refError.error);
  const canonical = canonicalRefs(pending.rollbackState, ruleset, pending.payload); const currentIndex = canonical?.findIndex((ref) => refKey(ref) === refKey(pending.currentHook)) ?? -1; if (!canonical || currentIndex < 0 || JSON.stringify(canonical.slice(currentIndex + 1)) !== JSON.stringify(pending.remainingHooks)) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: 'Pending lifecycle hook queue is not a canonical suffix for its payload.' };
  const pendingChoice = state.effectState.pendingChoice; const currentHook = findHook(ruleset, pending.currentHook); const programError = pendingChoice && currentHook ? validatePendingChoiceAgainstEffect(pendingChoice, currentHook.effect, state, ruleset) : 'Pending lifecycle choice or hook is missing.'; if (programError) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: programError };
  const next = structuredClone(state);
  const effect = resumeEffectChoice(next, ruleset, actorId, executionId, choiceId, optionId); effect.events = normalizedEffectEvents(pending, pending.currentHook, effect.events, 0);
  if (effect.status === 'failed' || effect.status === 'unsupported') return { status: effect.status, hookIds, evaluatedContinuousHookIds: [], events: [], effect, ...(effect.error ? { error: effect.error } : {}) };
  if (effect.status === 'suspended') { Object.assign(state, next); return { status: 'suspended', hookIds, evaluatedContinuousHookIds: [], events: effect.events, effect }; }
  delete next.effectState.pendingLifecycle;
  const result = continueHooks(next, ruleset, pending, pending.remainingHooks, effect.events);
  Object.assign(state, next);
  return result;
}

/** Resumes a multi-actor counter consent suspension, then continues the exact serialized lifecycle queue. */
export function resumeLifecycleCounterConsent(state: GameState, ruleset: Ruleset, actorId: string, requestId: string, action: 'accept' | 'decline' | 'cancel' | 'expire'): LifecycleDispatchResult {
  const pending = state.effectState.pendingLifecycle;
  if (!pending) return { status: 'failed', hookIds: [], evaluatedContinuousHookIds: [], events: [], error: 'No pending lifecycle dispatch.' };
  const hookIds = [pending.currentHook, ...pending.remainingHooks].map(({ hookId }) => hookId);
  if (pending.rollbackState.gameId !== state.gameId || JSON.stringify(pending.rollbackState.contentPacks) !== JSON.stringify(state.contentPacks) || JSON.stringify(pending.rollbackState.rulesModules) !== JSON.stringify(state.rulesModules)) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: 'Lifecycle rollback checkpoint registry does not match current state.' };
  const registryError = validateRegistry(pending.registry, state, ruleset);
  if (registryError) return fail(registryError.reason, hookIds, [], registryError.error);
  const refError = validateHookRefs(ruleset, [pending.currentHook, ...pending.remainingHooks]);
  if (refError) return fail(refError.reason, hookIds, [], refError.error);
  const canonical = canonicalRefs(pending.rollbackState, ruleset, pending.payload); const currentIndex = canonical?.findIndex((ref) => refKey(ref) === refKey(pending.currentHook)) ?? -1; if (!canonical || currentIndex < 0 || JSON.stringify(canonical.slice(currentIndex + 1)) !== JSON.stringify(pending.remainingHooks)) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: 'Pending lifecycle hook queue is not a canonical suffix for its payload.' };
  const consent = state.effectState.pendingCounterConsent; const currentHook = findHook(ruleset, pending.currentHook); const programError = consent && currentHook ? validatePendingCounterConsentAgainstEffect(consent, currentHook.effect) : 'Pending lifecycle counter consent or hook is missing.'; if (programError) return { status: 'failed', hookIds, evaluatedContinuousHookIds: [], events: [], error: programError };
  const next = structuredClone(state);
  const effect = resumeEffectCounterConsent(next, ruleset, actorId, requestId, action); effect.events = normalizedEffectEvents(pending, pending.currentHook, effect.events, 0);
  if (effect.status === 'failed' || effect.status === 'unsupported') return { status: effect.status, hookIds, evaluatedContinuousHookIds: [], events: [], effect, ...(effect.error ? { error: effect.error } : {}) };
  if (effect.status === 'suspended') { Object.assign(state, next); return { status: 'suspended', hookIds, evaluatedContinuousHookIds: [], events: effect.events, effect }; }
  delete next.effectState.pendingLifecycle;
  const result = continueHooks(next, ruleset, pending, pending.remainingHooks, effect.events);
  Object.assign(state, next);
  return result;
}
