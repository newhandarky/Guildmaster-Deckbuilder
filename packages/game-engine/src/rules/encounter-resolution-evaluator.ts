import type {
  EncounterCardMutation,
  EncounterCompletionEvaluation,
  EncounterCompletionRequest,
  EncounterCompletionResult,
  EncounterDisposition,
  EncounterEvaluationFailure,
  EncounterEvaluationFailureCode,
  EncounterPolicyRef,
  EncounterReasonCode,
  EncounterRegistryFingerprint,
  EncounterResolutionPolicy,
  EncounterTargetSnapshot,
  EnemyEncounterState,
  EnemyTargetDamageRequest,
  EnemyTargetDamageResult,
  EnemyTargetRef,
  EnemyTargetResolutionRequest,
  EnemyTargetResolutionResult,
  EnemyTargetState,
  GameState
} from '@guildmaster/game-protocol';
import type { Ruleset } from './ruleset.js';

type ValidEncounter = { encounter: EnemyEncounterState; targets: EnemyTargetState[]; policy: EncounterResolutionPolicy; registry: EncounterRegistryFingerprint };
type ValidationResult = { ok: true; value: ValidEncounter } | { ok: false; failure: EncounterEvaluationFailure };

const engineReason = (code: EncounterEvaluationFailureCode): EncounterReasonCode => ({ namespace: 'game-engine', code });
const fail = (reason: EncounterEvaluationFailureCode, error: string, status: 'failed' | 'unsupported' = 'failed'): EncounterEvaluationFailure => ({ status, reason, reasonCode: engineReason(reason), error });
const terminal = (target: EnemyTargetState): boolean => target.status === 'defeated' || target.status === 'removed';
const validHealth = (health: EnemyTargetState['health']): boolean => health === undefined || (Number.isFinite(health.current) && Number.isFinite(health.max) && Number.isInteger(health.current) && Number.isInteger(health.max) && health.current >= 0 && health.max >= 0 && health.current <= health.max);
const fingerprint = (state: GameState, ruleset: Ruleset): EncounterRegistryFingerprint => ({ rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) });

function validateRegistry(state: GameState, ruleset: Ruleset): EncounterEvaluationFailure | undefined {
  const stateIds = state.rulesModules.map(({ id }) => id);
  const rulesetIds = ruleset.modules.map(({ id }) => id);
  if (new Set(stateIds).size !== stateIds.length || new Set(rulesetIds).size !== rulesetIds.length || stateIds.some((id) => !rulesetIds.includes(id)) || rulesetIds.some((id) => !stateIds.includes(id))) return fail('UNKNOWN_MODULE', 'Encounter registry contains an unknown or duplicate Rules Module.');
  const stateRegistry: EncounterRegistryFingerprint = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
  if (JSON.stringify(stateRegistry) !== JSON.stringify(fingerprint(state, ruleset))) return fail('REGISTRY_VERSION_MISMATCH', 'Encounter policy registry fingerprint mismatch.');
  const packs = ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash }));
  const modules = ruleset.modules.map(({ id, version, config }) => ({ id, version, ...(config ? { config } : {}) }));
  if (JSON.stringify(state.contentPacks) !== JSON.stringify(packs) || JSON.stringify(state.rulesModules) !== JSON.stringify(modules)) return fail('REGISTRY_VERSION_MISMATCH', 'Encounter content or module configuration fingerprint mismatch.');
  return undefined;
}

function locateCard(state: GameState, cardId: string): string[] {
  const locations: string[] = [];
  for (const zone of Object.values(state.zones)) zone.cardIds.forEach((candidate) => { if (candidate === cardId) locations.push(`zone:${zone.zoneId}`); });
  state.removedCards.forEach((candidate) => { if (candidate === cardId) locations.push('removed'); });
  for (const player of state.players) {
    for (const zone of ['drawPile', 'hand', 'discardPile', 'playArea'] as const) player[zone].forEach((candidate) => { if (candidate === cardId) locations.push(`player:${player.id}:${zone}`); });
    player.party.forEach((slot, index) => { if (slot.adventurerId === cardId) locations.push(`player:${player.id}:party:${index}`); if (slot.equipmentId === cardId) locations.push(`player:${player.id}:equipment:${index}`); });
  }
  for (const target of Object.values(state.enemyTargets)) {
    if (!terminal(target) && target.cardInstanceId === cardId) locations.push(`target:${target.targetId}:card`);
    if (!terminal(target)) target.attachments.forEach((attachmentId, index) => { if (attachmentId === cardId) locations.push(`target:${target.targetId}:attachment:${index}`); });
  }
  return locations;
}

function resolvePolicy(ruleset: Ruleset, encounter: EnemyEncounterState, requested?: EncounterPolicyRef): EncounterResolutionPolicy | EncounterEvaluationFailure {
  const ref = requested ?? encounter.resolutionPolicy;
  if (!ref) return fail('MISSING_ENCOUNTER_POLICY', `Encounter ${encounter.encounterId} has no resolution policy.`);
  if (encounter.resolutionPolicy && (encounter.resolutionPolicy.moduleId !== ref.moduleId || encounter.resolutionPolicy.policyId !== ref.policyId)) return fail('POLICY_REF_MISMATCH', `Encounter ${encounter.encounterId} is bound to ${encounter.resolutionPolicy.moduleId}/${encounter.resolutionPolicy.policyId}.`);
  const module = ruleset.modules.find(({ id }) => id === ref.moduleId);
  if (!module) return fail('UNKNOWN_MODULE', `Unknown encounter policy module: ${ref.moduleId}.`);
  const policies = (module.encounterResolutionPolicies ?? []).filter(({ policyId }) => policyId === ref.policyId);
  if (!policies.length) return fail('UNKNOWN_POLICY', `Unknown encounter policy: ${ref.moduleId}/${ref.policyId}.`);
  if (policies.some(({ schemaVersion }) => schemaVersion !== 1)) return fail('UNKNOWN_POLICY_VERSION', `Unsupported encounter policy schema: ${ref.moduleId}/${ref.policyId}.`);
  if (policies.length > 1) {
    if (policies.some(({ priority }) => !Number.isFinite(priority)) || new Set(policies.map(({ priority }) => priority)).size !== policies.length) return fail('ORDER_POLICY_REQUIRED', `Encounter policy ${ref.moduleId}/${ref.policyId} has no deterministic order.`, 'unsupported');
    return [...policies].sort((left, right) => left.priority - right.priority)[0]!;
  }
  return policies[0]!;
}

function validateEncounter(state: GameState, ruleset: Ruleset, encounterId: string, requested?: EncounterPolicyRef): ValidationResult {
  const registryFailure = validateRegistry(state, ruleset); if (registryFailure) return { ok: false, failure: registryFailure };
  const encounters = state.enemyEncounters.filter((candidate) => candidate.encounterId === encounterId);
  if (!encounters.length) return { ok: false, failure: fail('UNKNOWN_ENCOUNTER', `Unknown encounter: ${encounterId}.`) };
  if (encounters.length > 1) return { ok: false, failure: fail('DUPLICATE_ENCOUNTER_ID', `Duplicate encounter ID: ${encounterId}.`) };
  const encounter = encounters[0]!;
  for (const targetId of encounter.targetIds) if (state.enemyEncounters.filter(({ targetIds }) => targetIds.includes(targetId)).length !== 1) return { ok: false, failure: fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${targetId} must be referenced by exactly one encounter.`) };
  if (new Set(encounter.targetIds).size !== encounter.targetIds.length) return { ok: false, failure: fail('DUPLICATE_TARGET_ID', `Encounter ${encounterId} contains duplicate target IDs.`) };
  const targets: EnemyTargetState[] = [];
  const partKeys = new Set<string>();
  const attachments = new Set<string>();
  for (const targetId of encounter.targetIds) {
    const target = state.enemyTargets[targetId];
    if (!target) return { ok: false, failure: fail('UNKNOWN_TARGET', `Encounter ${encounterId} references unknown target ${targetId}.`) };
    if (target.targetId !== targetId || target.parentEncounterId !== encounterId) return { ok: false, failure: fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${targetId} does not point back to encounter ${encounterId}.`) };
    if (target.partKey !== undefined) { if (partKeys.has(target.partKey)) return { ok: false, failure: fail('DUPLICATE_PART_KEY', `Encounter ${encounterId} contains duplicate part key ${target.partKey}.`) }; partKeys.add(target.partKey); }
    if (!validHealth(target.health)) return { ok: false, failure: fail('INVALID_HEALTH', `Target ${targetId} has invalid health.`) };
    if (!state.cards[target.cardInstanceId] || !ruleset.registry.definitions[state.cards[target.cardInstanceId]!.definitionId]) return { ok: false, failure: fail('UNKNOWN_CARD', `Unknown target card or definition: ${target.cardInstanceId}.`) };
    if (new Set(target.attachments).size !== target.attachments.length || target.attachments.includes(target.cardInstanceId)) return { ok: false, failure: fail('DUPLICATE_ATTACHMENT', `Target ${targetId} contains duplicate attachments.`) };
    for (const cardId of target.attachments) { if (!state.cards[cardId] || !ruleset.registry.definitions[state.cards[cardId]!.definitionId]) return { ok: false, failure: fail('UNKNOWN_CARD', `Unknown attachment card or definition: ${cardId}.`) }; if (attachments.has(cardId)) return { ok: false, failure: fail('DUPLICATE_ATTACHMENT', `Attachment ${cardId} belongs to more than one target.`) }; attachments.add(cardId); }
    if (!terminal(target)) {
      for (const cardId of [target.cardInstanceId, ...target.attachments]) { const locations = locateCard(state, cardId); if (locations.length !== 1) return { ok: false, failure: fail('CARD_LOCATION_CONFLICT', `Card ${cardId} must have exactly one location; found ${locations.join(', ') || 'none'}.`) }; }
    }
    targets.push(target);
  }
  for (const target of Object.values(state.enemyTargets)) if (target.parentEncounterId === encounterId && !encounter.targetIds.includes(target.targetId)) return { ok: false, failure: fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${target.targetId} points to encounter ${encounterId}, but the encounter does not reference it.`) };
  const policy = resolvePolicy(ruleset, encounter, requested); if ('status' in policy) return { ok: false, failure: policy };
  if (encounter.rulesModuleId && encounter.rulesModuleId !== policy.moduleId) return { ok: false, failure: fail('POLICY_REF_MISMATCH', `Encounter ${encounterId} is owned by ${encounter.rulesModuleId}, not ${policy.moduleId}.`) };
  return { ok: true, value: { encounter, targets, policy, registry: fingerprint(state, ruleset) } };
}

const targetRef = (target: EnemyTargetState): EnemyTargetRef => ({ targetId: target.targetId, cardInstanceId: target.cardInstanceId, targetKind: target.kind, parentEncounterId: target.parentEncounterId!, ...(target.partKey !== undefined ? { partKey: target.partKey } : {}) });
const targetSnapshot = (target: EnemyTargetState, status = target.status): EncounterTargetSnapshot => ({ ...targetRef(target), status, attachmentIds: [...target.attachments], ...(target.health ? { health: { ...target.health } } : {}) });

function completionFrom(valid: ValidEncounter, explicit: boolean, override?: { targetId: string; status: EnemyTargetState['status'] }): EncounterCompletionResult {
  const { encounter, policy, registry } = valid;
  const targets = valid.targets.map((target) => targetSnapshot(target, override?.targetId === target.targetId ? override.status : target.status));
  const condition = policy.completionCondition;
  let completed = false;
  if (condition.kind === 'explicit-only') completed = explicit;
  else if (targets.length && condition.kind === 'all-targets-defeated') completed = targets.every(({ status }) => status === 'defeated');
  else if (targets.length && condition.kind === 'all-targets-terminal') completed = targets.every(({ status }) => status === 'defeated' || status === 'removed');
  else if (condition.kind === 'required-targets-defeated') {
    for (const requiredId of condition.targetIds ?? []) if (!targets.some(({ targetId }) => targetId === requiredId)) return fail('REQUIRED_TARGET_NOT_FOUND', `Required target ${requiredId} is not in encounter ${encounter.encounterId}.`);
    for (const requiredPart of condition.partKeys ?? []) if (!targets.some(({ partKey }) => partKey === requiredPart)) return fail('REQUIRED_PART_NOT_FOUND', `Required part ${requiredPart} is not in encounter ${encounter.encounterId}.`);
    const required = targets.filter(({ targetId, partKey }) => condition.targetIds?.includes(targetId) || (partKey !== undefined && condition.partKeys?.includes(partKey)));
    completed = required.length > 0 && (condition.match === 'all' ? required.every(({ status }) => status === 'defeated') : required.some(({ status }) => status === 'defeated'));
  }
  const input = { schemaVersion: 1 as const, encounter: { encounterId: encounter.encounterId, encounterKind: encounter.kind }, fixedTargetIds: [...encounter.targetIds], targets, policy: { moduleId: policy.moduleId, policyId: policy.policyId }, registry };
  const evaluation: EncounterCompletionEvaluation = { schemaVersion: 1, input, completed, alreadyCompleted: encounter.status === 'finished', reasonCode: { ...policy.reasonCode } };
  return { status: 'ready', evaluation };
}

export function evaluateEncounterCompletion(state: GameState, ruleset: Ruleset, request: EncounterCompletionRequest | string, legacyPolicyId?: string): EncounterCompletionResult {
  const normalized: EncounterCompletionRequest = typeof request === 'string'
    ? { schemaVersion: 1, encounterId: request, ...(legacyPolicyId ? { policy: { moduleId: state.enemyEncounters.find(({ encounterId }) => encounterId === request)?.resolutionPolicy?.moduleId ?? '', policyId: legacyPolicyId } } : {}) }
    : request;
  if (normalized.schemaVersion !== 1) return fail('UNKNOWN_SCHEMA_VERSION', 'Unsupported encounter completion request schema.');
  const valid = validateEncounter(state, ruleset, normalized.encounterId, normalized.policy); if (!valid.ok) return valid.failure;
  return completionFrom(valid.value, normalized.explicit === true);
}

/** Validates persisted encounter refs against the active Ruleset without mutating state. */
export function validateEncounterStateAgainstRuleset(state: GameState, ruleset: Ruleset): string | undefined {
  const registryFailure = validateRegistry(state, ruleset);
  if (registryFailure) return registryFailure.error;
  for (const encounter of state.enemyEncounters) {
    if (!encounter.resolutionPolicy) continue;
    const result = validateEncounter(state, ruleset, encounter.encounterId);
    if (!result.ok) return result.failure.error;
  }
  return undefined;
}

function destinationMutations(state: GameState, policy: EncounterResolutionPolicy, target: EnemyTargetState, disposition: EncounterDisposition, cards: readonly { cardInstanceId: string; source: EncounterCardMutation['source'] }[]): EncounterCardMutation[] | EncounterEvaluationFailure {
  const ordered = [...cards]; if (disposition.kind !== 'removed' && disposition.ordering === 'reverse') ordered.reverse();
  if (disposition.kind === 'removed') return ordered.map(({ cardInstanceId, source }) => ({ cardInstanceId, source, destination: { kind: 'removed' } }));
  if (disposition.kind === 'shared-zone' || disposition.kind === 'module-zone') {
    const zone = state.zones[disposition.zoneId];
    if (!zone) return fail('INVALID_DESTINATION', `Unknown encounter destination zone: ${disposition.zoneId}.`);
    if (disposition.kind === 'module-zone' && (zone.kind !== 'moduleArea' || zone.rulesModuleId !== policy.moduleId)) return fail('INVALID_DESTINATION', `Zone ${disposition.zoneId} is not owned module area for ${policy.moduleId}.`);
    const destination = disposition.kind === 'module-zone' ? { kind: 'module-zone' as const, moduleId: policy.moduleId, zoneId: disposition.zoneId, position: disposition.position } : { kind: 'shared-zone' as const, zoneId: disposition.zoneId, position: disposition.position };
    return ordered.map(({ cardInstanceId, source }) => ({ cardInstanceId, source, destination }));
  }
  const mutations: EncounterCardMutation[] = [];
  for (const { cardInstanceId, source } of ordered) {
    const ownerId = state.cards[cardInstanceId]?.ownerId;
    if (!ownerId || !state.players.some(({ id }) => id === ownerId)) return fail('INVALID_DESTINATION', `Card ${cardInstanceId} has no valid owner for player-discard disposition.`);
    mutations.push({ cardInstanceId, source, destination: { kind: 'player-discard', playerId: ownerId, position: disposition.position } });
  }
  return mutations;
}

export function evaluateEnemyTargetResolution(state: GameState, ruleset: Ruleset, request: EnemyTargetResolutionRequest): EnemyTargetResolutionResult {
  if (request.schemaVersion !== 1) return fail('UNKNOWN_SCHEMA_VERSION', 'Unsupported target resolution request schema.');
  if (request.outcome !== 'defeated' && request.outcome !== 'removed') return fail('INVALID_INPUT', 'Target resolution outcome is invalid.');
  const target = state.enemyTargets[request.targetId]; if (!target) return fail('UNKNOWN_TARGET', `Unknown enemy target: ${request.targetId}.`);
  if (!target.parentEncounterId) return fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${request.targetId} has no encounter.`);
  const valid = validateEncounter(state, ruleset, target.parentEncounterId, request.policy); if (!valid.ok) return valid.failure;
  const canonical = valid.value.targets.find(({ targetId }) => targetId === request.targetId);
  if (!canonical) return fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${request.targetId} does not belong to encounter ${target.parentEncounterId}.`);
  if (valid.value.encounter.status === 'finished') return fail('ENCOUNTER_ALREADY_FINISHED', `Encounter ${valid.value.encounter.encounterId} is already finished.`);
  if (terminal(canonical)) return fail('TARGET_ALREADY_TERMINAL', `Enemy target ${request.targetId} is already terminal.`);
  const targetDisposition = request.outcome === 'removed' ? valid.value.policy.removedTargetDisposition : valid.value.policy.defeatedTargetDisposition;
  const targetCards = [{ cardInstanceId: canonical.cardInstanceId, source: { kind: 'enemy-target-card' as const, targetId: canonical.targetId } }];
  const attachmentCards = canonical.attachments.map((cardInstanceId, attachmentIndex) => ({ cardInstanceId, source: { kind: 'enemy-target-attachment' as const, targetId: canonical.targetId, attachmentIndex } }));
  const targetMutations = destinationMutations(state, valid.value.policy, canonical, targetDisposition, targetCards); if (!Array.isArray(targetMutations)) return targetMutations;
  const attachmentMutations = destinationMutations(state, valid.value.policy, canonical, valid.value.policy.attachmentDisposition, attachmentCards); if (!Array.isArray(attachmentMutations)) return attachmentMutations;
  const completion = completionFrom(valid.value, false, { targetId: canonical.targetId, status: request.outcome }); if (completion.status !== 'ready') return completion;
  return { status: 'ready', evaluation: { schemaVersion: 1, input: { schemaVersion: 1, encounter: { encounterId: valid.value.encounter.encounterId, encounterKind: valid.value.encounter.kind }, target: targetRef(canonical), fixedTargetIds: [...valid.value.encounter.targetIds], fixedAttachmentIds: [...canonical.attachments], terminalBefore: false, terminalAfter: true, outcome: request.outcome, policy: { moduleId: valid.value.policy.moduleId, policyId: valid.value.policy.policyId }, registry: valid.value.registry }, mutationPlan: { schemaVersion: 1, targetId: canonical.targetId, targetStatus: request.outcome, mutations: [...targetMutations, ...attachmentMutations] }, completion: completion.evaluation, reasonCode: { ...valid.value.policy.reasonCode } } };
}

export function evaluateEnemyTargetDamage(state: GameState, ruleset: Ruleset, request: EnemyTargetDamageRequest): EnemyTargetDamageResult {
  if (request.schemaVersion !== 1) return fail('UNKNOWN_SCHEMA_VERSION', 'Unsupported target damage request schema.');
  if (!Number.isFinite(request.requestedDamage) || !Number.isInteger(request.requestedDamage) || request.requestedDamage < 0) return fail('INVALID_DAMAGE', 'Requested damage must be a finite non-negative integer.');
  const target = state.enemyTargets[request.targetId]; if (!target) return fail('UNKNOWN_TARGET', `Unknown enemy target: ${request.targetId}.`);
  if (!target.parentEncounterId) return fail('INVALID_ENCOUNTER_RELATIONSHIP', `Target ${request.targetId} has no encounter.`);
  const valid = validateEncounter(state, ruleset, target.parentEncounterId, request.policy); if (!valid.ok) return valid.failure;
  const canonical = valid.value.targets.find(({ targetId }) => targetId === request.targetId)!;
  if (valid.value.encounter.status === 'finished') return fail('ENCOUNTER_ALREADY_FINISHED', `Encounter ${valid.value.encounter.encounterId} is already finished.`);
  if (terminal(canonical)) return fail('TARGET_ALREADY_TERMINAL', `Enemy target ${request.targetId} is already terminal.`);
  if (!canonical.health || !validHealth(canonical.health)) return fail('INVALID_HEALTH', `Target ${request.targetId} does not have valid health.`);
  const actualDamage = Math.min(request.requestedDamage, canonical.health.current);
  const healthAfter = { current: canonical.health.current - actualDamage, max: canonical.health.max };
  const lethal = healthAfter.current === 0;
  const resolution = lethal ? evaluateEnemyTargetResolution(state, ruleset, { schemaVersion: 1, targetId: request.targetId, outcome: 'defeated', ...(request.policy ? { policy: request.policy } : {}) }) : undefined;
  if (resolution && resolution.status !== 'ready') return resolution;
  return { status: 'ready', evaluation: { schemaVersion: 1, input: { schemaVersion: 1, encounter: { encounterId: valid.value.encounter.encounterId, encounterKind: valid.value.encounter.kind }, target: targetRef(canonical), fixedTargetIds: [...valid.value.encounter.targetIds], fixedAttachmentIds: [...canonical.attachments], healthBefore: { ...canonical.health }, requestedDamage: request.requestedDamage, policy: { moduleId: valid.value.policy.moduleId, policyId: valid.value.policy.policyId }, registry: valid.value.registry }, healthAfter, actualDamage, lethal, terminalBefore: false, terminalAfter: lethal, ...(resolution?.status === 'ready' ? { resolution: resolution.evaluation } : {}), reasonCode: { ...valid.value.policy.reasonCode } } };
}
