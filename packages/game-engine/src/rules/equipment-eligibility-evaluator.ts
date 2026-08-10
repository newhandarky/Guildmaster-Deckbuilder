import { EquipmentEligibilityInputSchema, type EquipmentEligibilityCondition, type EquipmentEligibilityEvaluation, type EquipmentEligibilityInput, type EquipmentEligibilityRule, type GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import type { Ruleset } from './ruleset.js';
import { evaluateContinuousEffects } from './continuous-evaluator.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type EquipmentEligibilityEvaluationResult =
  | { status: 'ready'; evaluation: EquipmentEligibilityEvaluation }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string }
  | { status: 'failed'; reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH' | 'UNKNOWN_RULE' | 'INVALID_INPUT'; error: string };

function registryError(state: GameState, ruleset: Ruleset): Extract<EquipmentEligibilityEvaluationResult, { status: 'failed' }> | undefined {
  if (state.rulesModules.some(({ id }) => !ruleset.modules.some((module) => module.id === id)) || ruleset.modules.some(({ id }) => !state.rulesModules.some((module) => module.id === id))) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: 'Equipment eligibility Rules Module registry contains an unknown module.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  return undefined;
}

function matches(condition: EquipmentEligibilityCondition, state: GameState, ruleset: Ruleset, input: EquipmentEligibilityInput): boolean {
  const player = state.players.find(({ id }) => id === input.playerId);
  const equipment = state.cards[input.equipmentCardId];
  const adventurer = state.cards[input.adventurerId];
  if (!player || !equipment || !adventurer) return false;
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'phase-is': return state.phase === condition.phase;
    case 'equipment-definition-in': return condition.definitionIds.includes(equipment.definitionId);
    case 'adventurer-definition-in': return condition.definitionIds.includes(adventurer.definitionId);
    case 'adventurer-tag-in': return condition.tags.some((tag) => getDefinition(ruleset.registry, state, input.adventurerId).tags?.includes(tag));
    case 'player-counter-at-least': return (getPlayer(state, input.playerId).counters.find(({ resourceId }) => resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'all': return condition.conditions.every((child) => matches(child, state, ruleset, input));
    case 'any': return condition.conditions.some((child) => matches(child, state, ruleset, input));
    case 'not': return !matches(condition.condition, state, ruleset, input);
  }
}

function order(rules: readonly EquipmentEligibilityRule[]): readonly EquipmentEligibilityRule[] | undefined {
  if (rules.length < 2) return rules;
  if (rules.some(({ priority }) => priority === undefined)) return undefined;
  const ordered = [...rules].sort((left, right) => left.priority! - right.priority!);
  return ordered.some((rule, index) => index > 0 && rule.priority === ordered[index - 1]!.priority) ? undefined : ordered;
}

/** Pure, deterministic equipment eligibility evaluation shared by queries and dispatch. */
export function evaluateEquipmentEligibility(state: GameState, ruleset: Ruleset, input: EquipmentEligibilityInput): EquipmentEligibilityEvaluationResult {
  const continuous = evaluateContinuousEffects(state, ruleset); if (continuous.status !== 'ready') return { status: continuous.status, reason: continuous.reason as 'ORDER_POLICY_REQUIRED', error: continuous.error } as EquipmentEligibilityEvaluationResult;
  if (!EquipmentEligibilityInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment eligibility input has an unsupported schema or invalid IDs.' };
  const mismatch = registryError(state, ruleset); if (mismatch) return mismatch;
  const player = state.players.find(({ id }) => id === input.playerId); const equipment = state.cards[input.equipmentCardId]; const adventurer = state.cards[input.adventurerId];
  if (!player || !equipment || !adventurer || !player.party.some((slot) => slot.adventurerId === input.adventurerId) || !player.hand.includes(input.equipmentCardId) || getDefinition(ruleset.registry, state, input.equipmentCardId).type !== 'equipment') return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment eligibility input does not name an equippable hand card and party adventurer.' };
  const active = ruleset.modules.flatMap((module) => module.equipmentEligibilityRules ?? []).filter((rule) => matches(rule.when, state, ruleset, input));
  const ordered = order(active); if (!ordered) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Active equipment eligibility rules require distinct explicit priorities.' };
  const continuousRestrictions = continuous.evaluation.active.filter((effect) => effect.target === 'equipment-restriction' && effect.amount !== 0);
  return { status: 'ready', evaluation: { schemaVersion: 1, eligible: ordered.length === 0 && !continuousRestrictions.length, rejectionReasonCodes: [...ordered.map((rule) => rule.reasonCode), ...continuousRestrictions.map((effect) => `CONTINUOUS:${effect.effectId}`)], appliedRules: ordered.map((rule) => ({ moduleId: rule.moduleId, ruleId: rule.ruleId })), registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } } };
}
