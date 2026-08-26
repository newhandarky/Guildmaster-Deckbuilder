import { isFiniteJsonValue, type DomainEvent, type DomainEventPayload, type EffectCardLocation, type EffectContext, type EncounterCardMutation, type EncounterDestinationMutationPlan, type EncounterEvaluationFailureCode, type EncounterPolicyRef, type EnemyTargetDamageEvaluation, type EnemyTargetResolutionEvaluation, type GameState } from '@guildmaster/game-protocol';
import { moveCard, resolveCardId, resolveLocation, type EngineCardLocation } from '../effects/movement.js';
import { evaluateEncounterCompletion, evaluateEnemyTargetDamage, evaluateEnemyTargetResolution } from '../rules/encounter-resolution-evaluator.js';
import type { Ruleset } from '../rules/ruleset.js';
import { validateRulesetStateCompatibility } from '../rules/ruleset.js';
import { validateGameStateInvariants } from './state-invariants.js';
import { attachedCardIds } from '../model/attachments.js';

type CreateEncounterNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'create-enemy-encounter' }>;
type CreateTargetNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'create-enemy-target' }>;
type AttachNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'attach-card-to-enemy-target' }>;
type DamageNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'damage-enemy-target' }>;
type DefeatNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'defeat-enemy-target' }>;
type RemoveNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'remove-enemy-target' }>;
type FinishNode = Extract<import('@guildmaster/game-protocol').EffectNode, { kind: 'finish-enemy-encounter' }>;

export type EncounterMutationFailure = { ok: false; status: 'failed' | 'unsupported'; reason: EncounterEvaluationFailureCode; error: string };
export type EncounterMutationSuccess<T = undefined> = { ok: true; status: 'completed'; evaluation?: T };
export type EncounterMutationResult<T = undefined> = EncounterMutationSuccess<T> | EncounterMutationFailure;

const reject = (reason: EncounterEvaluationFailureCode, error: string, status: 'failed' | 'unsupported' = 'failed'): EncounterMutationFailure => ({ ok: false, status, reason, error });
const fromEvaluation = (failure: { status: 'failed' | 'unsupported'; reason: EncounterEvaluationFailureCode; error: string }): EncounterMutationFailure => reject(failure.reason, failure.error, failure.status);
const emit = (state: GameState, events: DomainEvent[], type: string, message: string, payload: DomainEventPayload): void => { events.push({ eventId: `encounter-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, payload }); };
const commit = (target: GameState, source: GameState): void => { Object.assign(target, source); };
const healthValid = (health: { current: number; max: number } | undefined): boolean => health === undefined || (Number.isFinite(health.current) && Number.isFinite(health.max) && Number.isInteger(health.current) && Number.isInteger(health.max) && health.current >= 0 && health.max >= 0 && health.current <= health.max);
const blocksAssembly = (result: ReturnType<typeof evaluateEncounterCompletion>): boolean => result.status !== 'ready' && result.reason !== 'REQUIRED_TARGET_NOT_FOUND' && result.reason !== 'REQUIRED_PART_NOT_FOUND';
const registry = (state: GameState, ruleset: Ruleset) => ({ rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) });
function payload(state: GameState, ruleset: Ruleset, action: Extract<Extract<DomainEventPayload, { kind: 'encounter-resolution' }>['action'], string>, encounterId: string, targetId?: string, evaluation?: Extract<DomainEventPayload, { kind: 'encounter-resolution' }>['evaluation']): DomainEventPayload {
  const encounter = state.enemyEncounters.find((entry) => entry.encounterId === encounterId)!;
  const target = targetId ? state.enemyTargets[targetId] : undefined;
  return {
    schemaVersion: 1,
    kind: 'encounter-resolution',
    action,
    encounter: { encounterId: encounter.encounterId, encounterKind: encounter.kind },
    policy: encounter.resolutionPolicy!,
    registry: registry(state, ruleset),
    ...(target ? { target: { targetId: target.targetId, cardInstanceId: target.cardInstanceId, targetKind: target.kind, parentEncounterId: target.parentEncounterId!, ...(target.partKey !== undefined ? { partKey: target.partKey } : {}) } } : {}),
    ...(evaluation ? { evaluation } : {})
  };
}

function registryFailure(state: GameState, ruleset: Ruleset): EncounterMutationFailure | undefined {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return reject('REGISTRY_VERSION_MISMATCH', compatibility);
  const stateRefs = state.rulesModules.map(({ id, version }) => `${id}@${version}`);
  const rulesetRefs = ruleset.modules.map(({ id, version }) => `${id}@${version}`);
  if (new Set(state.rulesModules.map(({ id }) => id)).size !== state.rulesModules.length || state.rulesModules.some(({ id }) => !ruleset.modules.some((module) => module.id === id)) || ruleset.modules.some(({ id }) => !state.rulesModules.some((module) => module.id === id))) return reject('UNKNOWN_MODULE', 'Encounter registry contains an unknown or duplicate Rules Module.');
  if (!state.rulesetVersion.trim() || JSON.stringify(stateRefs) !== JSON.stringify(rulesetRefs)) return reject('REGISTRY_VERSION_MISMATCH', 'Encounter policy registry fingerprint mismatch.');
  return undefined;
}

function cardLocations(state: GameState, cardId: string): string[] {
  const locations: string[] = [];
  for (const zone of Object.values(state.zones)) zone.cardIds.forEach((candidate) => { if (candidate === cardId) locations.push(`zone:${zone.zoneId}`); });
  state.removedCards.forEach((candidate) => { if (candidate === cardId) locations.push('removed'); });
  for (const player of state.players) {
    for (const zone of ['drawPile', 'hand', 'discardPile', 'playArea'] as const) player[zone].forEach((candidate) => { if (candidate === cardId) locations.push(`player:${player.id}:${zone}`); });
    player.party.forEach((slot, index) => { if (slot.adventurerId === cardId) locations.push(`player:${player.id}:party:${index}`); if (attachedCardIds(slot).includes(cardId)) locations.push(`player:${player.id}:equipment:${index}`); });
  }
  for (const target of Object.values(state.enemyTargets)) if (target.status !== 'defeated' && target.status !== 'removed') {
    if (target.cardInstanceId === cardId) locations.push(`target:${target.targetId}:card`);
    target.attachments.forEach((attachmentId, index) => { if (attachmentId === cardId) locations.push(`target:${target.targetId}:attachment:${index}`); });
  }
  return locations;
}

function transactional<T>(state: GameState, events: DomainEvent[], operation: (next: GameState, nextEvents: DomainEvent[]) => EncounterMutationResult<T>): EncounterMutationResult<T> {
  const next = structuredClone(state); const priorEventCount = events.length; const nextEvents: DomainEvent[] = [...events];
  try {
    const result = operation(next, nextEvents);
    if (!result.ok) return result;
    const invariantErrors = validateGameStateInvariants(next); if (invariantErrors.length) return reject('INVALID_INPUT', `Encounter mutation produced invalid state: ${invariantErrors.join(' ')}`);
    commit(state, next); events.push(...nextEvents.slice(priorEventCount)); return result;
  } catch (error) {
    return reject('INVALID_INPUT', error instanceof Error ? error.message : 'Encounter mutation failed.');
  }
}

function destinationLocation(mutation: EncounterCardMutation): EngineCardLocation {
  const destination = mutation.destination;
  if (destination.kind === 'removed') return { kind: 'removed' };
  if (destination.kind === 'player-discard') return { kind: 'player-zone', player: { kind: 'player-id', playerId: destination.playerId }, zone: 'discardPile' };
  return { kind: 'shared-zone', zoneId: destination.zoneId };
}

function sourceLocation(mutation: EncounterCardMutation): EngineCardLocation {
  return mutation.source.kind === 'enemy-target-card' ? { kind: 'enemy-target-card', targetId: mutation.source.targetId } : { kind: 'enemy-target-attachment', targetId: mutation.source.targetId };
}

const destinationKey = (mutation: EncounterCardMutation): string => JSON.stringify(mutation.destination);
function applyMutationPlan(state: GameState, ruleset: Ruleset, plan: EncounterDestinationMutationPlan): EncounterMutationFailure | undefined {
  const target = state.enemyTargets[plan.targetId];
  if (!target || target.status === 'defeated' || target.status === 'removed') return reject('TARGET_ALREADY_TERMINAL', `Enemy target ${plan.targetId} is terminal or unknown.`);
  const groups = new Map<string, EncounterCardMutation[]>();
  for (const mutation of plan.mutations) { const group = groups.get(destinationKey(mutation)) ?? []; group.push(mutation); groups.set(destinationKey(mutation), group); }
  for (const group of groups.values()) {
    const position = group[0]!.destination.kind === 'removed' ? undefined : group[0]!.destination.position;
    const execution = position === 'bottom' ? [...group].reverse() : group;
    for (const mutation of execution) {
      const moved = moveCard(state, { cardInstanceId: mutation.cardInstanceId, from: sourceLocation(mutation), to: destinationLocation(mutation), actorId: state.activePlayerId, context: { controllerId: state.activePlayerId }, registry: ruleset.registry, ...(position ? { position } : {}), permission: 'system' });
      if (!moved.ok) return reject(moved.code === 'SOURCE_MISMATCH' ? 'INVALID_SOURCE' : 'INVALID_DESTINATION', `${moved.code}: ${moved.message}`);
    }
  }
  target.status = plan.targetStatus;
  target.attachments = [];
  if (state.temporaryTargetModifiers) state.temporaryTargetModifiers = state.temporaryTargetModifiers.filter(({ targetCardId }) => targetCardId !== target.cardInstanceId);
  return undefined;
}

export function createEnemyEncounter(state: GameState, ruleset: Ruleset, node: CreateEncounterNode, events: DomainEvent[]): EncounterMutationResult {
  const registry = registryFailure(state, ruleset); if (registry) return registry;
  if (!node.encounterId.trim() || !node.encounterKind.trim() || !node.rulesModuleId.trim() || !node.policy.moduleId.trim() || !node.policy.policyId.trim()) return reject('INVALID_INPUT', 'Encounter creation requires non-empty IDs.');
  if (!isFiniteJsonValue(node.moduleState ?? {})) return reject('INVALID_INPUT', 'Encounter module state must be finite, acyclic JSON-only data.');
  if (state.enemyEncounters.some(({ encounterId }) => encounterId === node.encounterId)) return reject('DUPLICATE_ENCOUNTER_ID', `Duplicate encounter ID: ${node.encounterId}.`);
  if (node.rulesModuleId !== node.policy.moduleId) return reject('POLICY_REF_MISMATCH', 'Encounter owner must match its resolution policy module.');
  const module = ruleset.modules.find(({ id }) => id === node.policy.moduleId); if (!module) return reject('UNKNOWN_MODULE', `Unknown encounter module: ${node.policy.moduleId}.`);
  const policies = (module.encounterResolutionPolicies ?? []).filter(({ policyId }) => policyId === node.policy.policyId);
  if (!policies.length) return reject('UNKNOWN_POLICY', `Unknown encounter policy: ${node.policy.moduleId}/${node.policy.policyId}.`);
  if (policies.some(({ schemaVersion }) => schemaVersion !== 1)) return reject('UNKNOWN_POLICY_VERSION', `Unsupported encounter policy schema: ${node.policy.moduleId}/${node.policy.policyId}.`);
  if (policies.some(({ moduleId: owner }) => owner !== node.policy.moduleId)) return reject('POLICY_REF_MISMATCH', `Encounter policy ${node.policy.policyId} has mismatched ownership.`);
  if (policies.length > 1 && new Set(policies.map(({ priority }) => priority)).size !== policies.length) return reject('ORDER_POLICY_REQUIRED', 'Encounter policy order is ambiguous.', 'unsupported');
  return transactional(state, events, (next, nextEvents) => {
    next.enemyEncounters.push({ encounterId: node.encounterId, targetIds: [], kind: node.encounterKind, status: 'active', rulesModuleId: node.rulesModuleId, resolutionPolicy: { ...node.policy }, state: structuredClone(node.moduleState ?? {}) });
    emit(next, nextEvents, 'ENCOUNTER_CREATED', `Encounter ${node.encounterId} created.`, payload(next, ruleset, 'created', node.encounterId));
    return { ok: true, status: 'completed' };
  });
}

function validateSource(state: GameState, source: EffectCardLocation, cardId: string, context: EffectContext): EncounterMutationFailure | EngineCardLocation {
  const resolved = resolveLocation(source, context); if (!resolved) return reject('INVALID_SOURCE', 'Card source could not be resolved.');
  const locations = cardLocations(state, cardId); if (locations.length !== 1) return reject('CARD_LOCATION_CONFLICT', `Card ${cardId} must have exactly one location; found ${locations.join(', ') || 'none'}.`);
  return resolved;
}

export function createEnemyTarget(state: GameState, ruleset: Ruleset, node: CreateTargetNode, context: EffectContext, events: DomainEvent[]): EncounterMutationResult {
  if (!node.targetId.trim() || !node.encounterId.trim() || !node.targetKind.trim() || (node.partKey !== undefined && !node.partKey.trim()) || !healthValid(node.health) || !isFiniteJsonValue(node.moduleState ?? {})) return reject(node.health && !healthValid(node.health) ? 'INVALID_HEALTH' : 'INVALID_INPUT', 'Enemy target creation input is invalid.');
  const encounter = state.enemyEncounters.find(({ encounterId }) => encounterId === node.encounterId); if (!encounter) return reject('UNKNOWN_ENCOUNTER', `Unknown encounter: ${node.encounterId}.`);
  const completion = evaluateEncounterCompletion(state, ruleset, { schemaVersion: 1, encounterId: node.encounterId }); if (blocksAssembly(completion) && completion.status !== 'ready') return fromEvaluation(completion);
  if (encounter.status === 'finished') return reject('ENCOUNTER_ALREADY_FINISHED', `Encounter ${node.encounterId} is already finished.`);
  if (state.enemyTargets[node.targetId] || encounter.targetIds.includes(node.targetId)) return reject('DUPLICATE_TARGET_ID', `Duplicate target ID: ${node.targetId}.`);
  if (node.partKey && encounter.targetIds.some((id) => state.enemyTargets[id]?.partKey === node.partKey)) return reject('DUPLICATE_PART_KEY', `Duplicate encounter part key: ${node.partKey}.`);
  const cardId = resolveCardId(node.card, context); if (!cardId || !state.cards[cardId]) return reject('UNKNOWN_CARD', 'Enemy target card is unknown.');
  const source = validateSource(state, node.from, cardId, context); if ('ok' in source) return source;
  return transactional(state, events, (next, nextEvents) => {
    const nextEncounter = next.enemyEncounters.find(({ encounterId }) => encounterId === node.encounterId)!;
    next.enemyTargets[node.targetId] = { targetId: node.targetId, cardInstanceId: cardId, kind: node.targetKind, status: 'available', parentEncounterId: node.encounterId, ...(node.partKey !== undefined ? { partKey: node.partKey } : {}), ...(node.health ? { health: { ...node.health } } : {}), attachments: [], moduleState: structuredClone(node.moduleState ?? {}) };
    const moved = moveCard(next, { cardInstanceId: cardId, from: source, to: { kind: 'enemy-target-card', targetId: node.targetId }, actorId: context.controllerId, context, registry: ruleset.registry, permission: 'system' });
    if (!moved.ok) return reject(moved.code === 'SOURCE_MISMATCH' ? 'INVALID_SOURCE' : 'INVALID_DESTINATION', `${moved.code}: ${moved.message}`);
    nextEncounter.targetIds.push(node.targetId);
    emit(next, nextEvents, 'ENEMY_TARGET_CREATED', `Enemy target ${node.targetId} created.`, payload(next, ruleset, 'target-created', node.encounterId, node.targetId));
    return { ok: true, status: 'completed' };
  });
}

export function attachCardToEnemyTarget(state: GameState, ruleset: Ruleset, node: AttachNode, context: EffectContext, events: DomainEvent[]): EncounterMutationResult {
  const target = state.enemyTargets[node.targetId]; if (!target) return reject('UNKNOWN_TARGET', `Unknown enemy target: ${node.targetId}.`);
  if (target.status === 'defeated' || target.status === 'removed') return reject('TARGET_ALREADY_TERMINAL', `Enemy target ${node.targetId} is already terminal.`);
  if (!target.parentEncounterId) return reject('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${node.targetId} has no encounter.`);
  const completion = evaluateEncounterCompletion(state, ruleset, { schemaVersion: 1, encounterId: target.parentEncounterId }); if (blocksAssembly(completion) && completion.status !== 'ready') return fromEvaluation(completion);
  const cardId = resolveCardId(node.card, context); if (!cardId || !state.cards[cardId]) return reject('UNKNOWN_CARD', 'Enemy attachment card is unknown.');
  if (cardId === target.cardInstanceId || target.attachments.includes(cardId) || Object.values(state.enemyTargets).some((candidate) => candidate.attachments.includes(cardId) || candidate.cardInstanceId === cardId)) return reject('DUPLICATE_ATTACHMENT', `Card ${cardId} is already an enemy target card or attachment.`);
  const source = validateSource(state, node.from, cardId, context); if ('ok' in source) return source;
  return transactional(state, events, (next, nextEvents) => {
    const moved = moveCard(next, { cardInstanceId: cardId, from: source, to: { kind: 'enemy-target-attachment', targetId: node.targetId }, actorId: context.controllerId, context, registry: ruleset.registry, position: node.position ?? 'bottom', permission: 'system' });
    if (!moved.ok) return reject(moved.code === 'SOURCE_MISMATCH' ? 'INVALID_SOURCE' : 'INVALID_DESTINATION', `${moved.code}: ${moved.message}`);
    emit(next, nextEvents, 'ENEMY_ATTACHMENT_ADDED', `Attachment ${cardId} added to ${node.targetId}.`, payload(next, ruleset, 'attachment-added', target.parentEncounterId!, node.targetId));
    return { ok: true, status: 'completed' };
  });
}

function resolveTarget(state: GameState, ruleset: Ruleset, targetId: string, outcome: 'defeated' | 'removed', policy: EncounterPolicyRef, events: DomainEvent[]): EncounterMutationResult<EnemyTargetResolutionEvaluation> {
  const evaluation = evaluateEnemyTargetResolution(state, ruleset, { schemaVersion: 1, targetId, outcome, policy });
  if (evaluation.status !== 'ready') return fromEvaluation(evaluation);
  return transactional(state, events, (next, nextEvents) => {
    const planFailure = applyMutationPlan(next, ruleset, evaluation.evaluation.mutationPlan); if (planFailure) return planFailure;
    const encounter = next.enemyEncounters.find(({ encounterId }) => encounterId === evaluation.evaluation.input.encounter.encounterId)!;
    emit(next, nextEvents, outcome === 'defeated' ? 'ENEMY_TARGET_DEFEATED' : 'ENEMY_TARGET_REMOVED', `Enemy target ${targetId} resolved.`, payload(next, ruleset, outcome === 'defeated' ? 'target-defeated' : 'target-removed', encounter.encounterId, targetId, evaluation.evaluation));
    if (evaluation.evaluation.completion.completed && !evaluation.evaluation.completion.alreadyCompleted) { encounter.status = 'finished'; emit(next, nextEvents, 'ENCOUNTER_COMPLETED', `Encounter ${encounter.encounterId} completed.`, payload(next, ruleset, 'completed', encounter.encounterId, undefined, evaluation.evaluation.completion)); }
    return { ok: true, status: 'completed', evaluation: evaluation.evaluation };
  });
}

export function damageEnemyTarget(state: GameState, ruleset: Ruleset, node: DamageNode, events: DomainEvent[]): EncounterMutationResult<EnemyTargetDamageEvaluation> {
  const evaluation = evaluateEnemyTargetDamage(state, ruleset, { schemaVersion: 1, targetId: node.targetId, requestedDamage: node.amount, policy: node.policy });
  if (evaluation.status !== 'ready') return fromEvaluation(evaluation);
  return applyEnemyTargetDamageEvaluation(state, ruleset, evaluation.evaluation, events);
}

/** Applies one previously fixed pure damage evaluation without recomputing policy selection. */
export function applyEnemyTargetDamageEvaluation(state: GameState, ruleset: Ruleset, evaluation: EnemyTargetDamageEvaluation, events: DomainEvent[]): EncounterMutationResult<EnemyTargetDamageEvaluation> {
  const canonical = evaluateEnemyTargetDamage(state, ruleset, {
    schemaVersion: 1,
    targetId: evaluation.input.target.targetId,
    requestedDamage: evaluation.input.requestedDamage,
    policy: evaluation.input.policy,
    lethalOutcome: evaluation.input.lethalOutcome
  });
  if (canonical.status !== 'ready') return fromEvaluation(canonical);
  if (JSON.stringify(canonical.evaluation) !== JSON.stringify(evaluation)) return reject('INVALID_INPUT', 'Enemy target damage evaluation is stale or was tampered.');
  return transactional(state, events, (next, nextEvents) => {
    const targetId = evaluation.input.target.targetId;
    const target = next.enemyTargets[targetId]!;
    target.health = { ...evaluation.healthAfter };
    emit(next, nextEvents, 'ENEMY_TARGET_DAMAGED', `Enemy target ${targetId} took ${evaluation.actualDamage} damage.`, payload(next, ruleset, 'damaged', evaluation.input.encounter.encounterId, targetId, evaluation));
    const resolution = evaluation.resolution;
    if (resolution) {
      const planFailure = applyMutationPlan(next, ruleset, resolution.mutationPlan); if (planFailure) return planFailure;
      emit(next, nextEvents, resolution.input.outcome === 'removed' ? 'ENEMY_TARGET_REMOVED' : 'ENEMY_TARGET_DEFEATED', `Enemy target ${targetId} resolved.`, payload(next, ruleset, resolution.input.outcome === 'removed' ? 'target-removed' : 'target-defeated', resolution.input.encounter.encounterId, targetId, resolution));
      if (resolution.completion.completed && !resolution.completion.alreadyCompleted) { const encounter = next.enemyEncounters.find(({ encounterId }) => encounterId === resolution.input.encounter.encounterId)!; encounter.status = 'finished'; emit(next, nextEvents, 'ENCOUNTER_COMPLETED', `Encounter ${encounter.encounterId} completed.`, payload(next, ruleset, 'completed', encounter.encounterId, undefined, resolution.completion)); }
    }
    return { ok: true, status: 'completed', evaluation };
  });
}

export const defeatEnemyTarget = (state: GameState, ruleset: Ruleset, node: DefeatNode, events: DomainEvent[]): EncounterMutationResult<EnemyTargetResolutionEvaluation> => resolveTarget(state, ruleset, node.targetId, 'defeated', node.policy, events);
export const removeEnemyTarget = (state: GameState, ruleset: Ruleset, node: RemoveNode, events: DomainEvent[]): EncounterMutationResult<EnemyTargetResolutionEvaluation> => resolveTarget(state, ruleset, node.targetId, 'removed', node.policy, events);

export function finishEnemyEncounter(state: GameState, ruleset: Ruleset, node: FinishNode, events: DomainEvent[]): EncounterMutationResult {
  const evaluation = evaluateEncounterCompletion(state, ruleset, { schemaVersion: 1, encounterId: node.encounterId, policy: node.policy, explicit: true });
  if (evaluation.status !== 'ready') return fromEvaluation(evaluation);
  if (evaluation.evaluation.alreadyCompleted) return reject('ENCOUNTER_ALREADY_FINISHED', `Encounter ${node.encounterId} is already finished.`);
  if (!evaluation.evaluation.completed) return reject('COMPLETION_CONDITION_NOT_MET', `Encounter ${node.encounterId} completion condition is not satisfied.`);
  return transactional(state, events, (next, nextEvents) => {
    next.enemyEncounters.find(({ encounterId }) => encounterId === node.encounterId)!.status = 'finished';
    emit(next, nextEvents, 'ENCOUNTER_COMPLETED', `Encounter ${node.encounterId} completed.`, payload(next, ruleset, 'completed', node.encounterId, undefined, evaluation.evaluation));
    return { ok: true, status: 'completed' };
  });
}
