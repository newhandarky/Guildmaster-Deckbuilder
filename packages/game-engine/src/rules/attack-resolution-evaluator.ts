import { AttackResolutionRequestSchema, type AttackResolutionCondition, type AttackResolutionFailure, type AttackResolutionPolicy, type AttackResolutionRequest, type AttackResolutionResult, type GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { evaluateEnemyTargetDamage } from './encounter-resolution-evaluator.js';
import { evaluateCombat, evaluateCombatPartyPrefix } from './combat-evaluator.js';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

const fail = (reason: AttackResolutionFailure['reason'], error: string, status: 'failed' | 'unsupported' = 'failed'): AttackResolutionFailure => ({ status, reason, error });
const fingerprint = (state: GameState, ruleset: Ruleset) => ({ rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) });

function matches(condition: AttackResolutionCondition, state: GameState, playerId: string, targetId: string): boolean {
  const target = state.enemyTargets[targetId];
  if (!target) return false;
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'target-kind-in': return condition.kinds.includes(target.kind);
    case 'encounter-kind-in': return Boolean(encounter && condition.kinds.includes(encounter.kind));
    case 'target-part-key-in': return target.partKey !== undefined && condition.partKeys.includes(target.partKey);
    case 'target-health-at-most': return target.health !== undefined && target.health.current <= condition.amount;
    case 'player-counter-at-least': return (getPlayer(state, playerId).counters.find(({ resourceId }) => resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'all': return condition.conditions.every((child) => matches(child, state, playerId, targetId));
    case 'any': return condition.conditions.some((child) => matches(child, state, playerId, targetId));
    case 'not': return !matches(condition.condition, state, playerId, targetId);
  }
}

function selectPolicy(state: GameState, ruleset: Ruleset, playerId: string, targetId: string): AttackResolutionPolicy | AttackResolutionFailure {
  const active = ruleset.modules.flatMap((module) => module.attackResolutionPolicies ?? []).filter((policy) => matches(policy.when, state, playerId, targetId));
  if (!active.length) return fail('NO_MATCHING_POLICY', `Health target ${targetId} has no matching attack resolution policy.`);
  const ordered = [...active].sort((left, right) => left.priority - right.priority);
  if (ordered.some((policy, index) => index > 0 && policy.priority === ordered[index - 1]!.priority)) return fail('ORDER_POLICY_REQUIRED', 'Matching attack resolution policies require distinct explicit priorities.', 'unsupported');
  return ordered[0]!;
}

/** Pure deterministic health-target attack evaluation shared by legal query and dispatch. */
export function evaluateAttackResolution(state: GameState, ruleset: Ruleset, request: AttackResolutionRequest): AttackResolutionResult {
  if (request.schemaVersion !== 1) return fail('UNKNOWN_SCHEMA_VERSION', 'Unsupported attack resolution request schema.');
  const parsed = AttackResolutionRequestSchema.safeParse(request);
  if (!parsed.success) return fail('INVALID_REQUEST', `Malformed attack resolution request: ${parsed.error.issues[0]?.message ?? 'invalid input'}.`);
  request = parsed.data;
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return fail('REGISTRY_VERSION_MISMATCH', compatibility);
  const registry = fingerprint(state, ruleset);
  if (JSON.stringify(request.registry) !== JSON.stringify(registry)) return fail('REGISTRY_VERSION_MISMATCH', 'Attack resolution registry fingerprint mismatch.');
  if (!state.players.some(({ id }) => id === request.playerId)) return fail('UNKNOWN_PLAYER', `Unknown attack player: ${request.playerId}.`);
  const target = state.enemyTargets[request.targetId];
  if (!target) return fail('UNKNOWN_TARGET', `Unknown attack target: ${request.targetId}.`);
  if (target.status !== 'available') return fail('TARGET_NOT_AVAILABLE', `Attack target ${request.targetId} is not available.`);
  if (!target.health) return fail('TARGET_HAS_NO_HEALTH', `Attack target ${request.targetId} has no health state.`);
  const encounter = target.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  if (encounter?.status === 'finished') return fail('ENCOUNTER_ALREADY_FINISHED', `Encounter ${encounter.encounterId} is already finished.`);
  const combat = evaluateCombat(state, ruleset, request.playerId, request.targetId);
  if (combat.status !== 'ready') return fail('COMBAT_NOT_READY', combat.error, combat.status);
  if (!combat.evaluation.eligible) return fail('COMBAT_RESTRICTED', `Attack target is restricted: ${combat.evaluation.restrictionReasonCodes.join(', ')}.`);
  const partyPrefix = evaluateCombatPartyPrefix(state, ruleset, request.playerId, combat.evaluation.requiredCombat, request.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed);
  if (!partyPrefix) return fail('INSUFFICIENT_COMBAT', `Player ${request.playerId} cannot meet combat ${combat.evaluation.requiredCombat}.`);
  const policy = selectPolicy(state, ruleset, request.playerId, request.targetId);
  if ('status' in policy) return policy;
  const damage = evaluateEnemyTargetDamage(state, ruleset, {
    schemaVersion: 1,
    targetId: request.targetId,
    requestedDamage: policy.damage.amount,
    policy: policy.encounterPolicy,
    lethalOutcome: combat.evaluation.outcome.kind === 'remove-target' ? 'removed' : 'defeated'
  });
  if (damage.status !== 'ready') return fail('INVALID_ENCOUNTER_DAMAGE', `${damage.reason}: ${damage.error}`, damage.status);
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      input: structuredClone(request),
      policy: { moduleId: policy.moduleId, policyId: policy.policyId },
      combat: structuredClone(combat.evaluation),
      partyPrefix: structuredClone(partyPrefix),
      damage: structuredClone(damage.evaluation),
      reasonCode: { ...policy.reasonCode }
    }
  };
}
