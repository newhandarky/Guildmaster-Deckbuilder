import { EquipmentEligibilityInputSchema, type EquipmentCombatModifierEvaluation, type EquipmentCombatModifierRule, type EquipmentEligibilityCondition, type EquipmentEligibilityInput, type GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type EquipmentCombatModifierEvaluationResult =
  | { status: 'ready'; evaluation: EquipmentCombatModifierEvaluation }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string }
  | { status: 'failed'; reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH' | 'INVALID_INPUT' | 'INVALID_COMBAT_VALUE'; error: string };

function registryError(state: GameState, ruleset: Ruleset): Extract<EquipmentCombatModifierEvaluationResult, { status: 'failed' }> | undefined {
  if (state.rulesModules.some(({ id }) => !ruleset.modules.some((module) => module.id === id)) || ruleset.modules.some(({ id }) => !state.rulesModules.some((module) => module.id === id))) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: 'Equipment combat modifier Rules Module registry contains an unknown module.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  return undefined;
}

function matches(condition: EquipmentEligibilityCondition, state: GameState, ruleset: Ruleset, input: EquipmentEligibilityInput): boolean {
  const player = state.players.find(({ id }) => id === input.playerId);
  const equipment = state.cards[input.equipmentCardId];
  const adventurer = state.cards[input.adventurerId];
  if (!player || !equipment || !adventurer) return false;
  const adventurerDefinition = getDefinition(ruleset.registry, state, input.adventurerId);
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'phase-is': return state.phase === condition.phase;
    case 'equipment-definition-in': return condition.definitionIds.includes(equipment.definitionId);
    case 'adventurer-definition-in': return condition.definitionIds.includes(adventurer.definitionId);
    case 'adventurer-tag-in': return condition.tags.some((tag) => adventurerDefinition.tags?.includes(tag));
    case 'player-counter-at-least': return (getPlayer(state, input.playerId).counters.find(({ resourceId }) => resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'all': return condition.conditions.every((child) => matches(child, state, ruleset, input));
    case 'any': return condition.conditions.some((child) => matches(child, state, ruleset, input));
    case 'not': return !matches(condition.condition, state, ruleset, input);
  }
}

function order(rules: readonly EquipmentCombatModifierRule[]): readonly EquipmentCombatModifierRule[] | undefined {
  if (rules.length < 2) return rules;
  if (rules.some(({ priority }) => priority === undefined)) return undefined;
  const ordered = [...rules].sort((left, right) => left.priority! - right.priority!);
  return ordered.some((rule, index) => index > 0 && rule.priority === ordered[index - 1]!.priority) ? undefined : ordered;
}

/** Pure evaluation of combat power contributed by one currently attached equipment pair. */
export function evaluateEquipmentCombatModifiers(state: GameState, ruleset: Ruleset, input: EquipmentEligibilityInput): EquipmentCombatModifierEvaluationResult {
  if (!EquipmentEligibilityInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment combat modifier input has an unsupported schema or invalid IDs.' };
  const mismatch = registryError(state, ruleset); if (mismatch) return mismatch;
  const player = state.players.find(({ id }) => id === input.playerId);
  const slot = player?.party.find(({ adventurerId }) => adventurerId === input.adventurerId);
  const equipment = state.cards[input.equipmentCardId];
  if (!player || !slot || !attachedCardIds(slot).includes(input.equipmentCardId) || !equipment || getDefinition(ruleset.registry, state, input.equipmentCardId).type !== 'equipment') return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment combat modifier input does not name an attached equipment/adventurer pair.' };
  const active = ruleset.modules.flatMap((module) => module.equipmentCombatModifierRules ?? []).filter((rule) => matches(rule.when, state, ruleset, input));
  const ordered = order(active);
  if (!ordered) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Active equipment combat modifier rules require distinct explicit priorities.' };
  const powerBonus = ordered.reduce((sum, rule) => sum + rule.amount, 0);
  if (!Number.isFinite(powerBonus)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: 'Equipment combat modifiers overflowed party power.' };
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      powerBonus,
      appliedRules: ordered.map(({ moduleId, ruleId }) => ({ moduleId, ruleId })),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
    },
  };
}
