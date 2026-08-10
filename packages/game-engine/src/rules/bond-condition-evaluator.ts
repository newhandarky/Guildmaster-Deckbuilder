import type { BondCondition, BondConditionRule, BondEvaluation, BondPlayerZone, GameState, PlayerState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type BondEvaluationFailureReason =
  | 'REGISTRY_VERSION_MISMATCH'
  | 'UNKNOWN_PLAYER'
  | 'UNKNOWN_BOND'
  | 'UNKNOWN_MODULE'
  | 'UNKNOWN_RULE'
  | 'RULE_VERSION_MISMATCH';

export type BondEvaluationResult =
  | { status: 'ready'; evaluation: BondEvaluation }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string }
  | { status: 'failed'; reason: BondEvaluationFailureReason; error: string };

function cardIdsInZones(player: PlayerState, zones: readonly BondPlayerZone[]): readonly string[] {
  return zones.flatMap((zone) => {
    switch (zone) {
      case 'party': return player.party.map((slot) => slot.adventurerId);
      case 'equipment': return player.party.flatMap((slot) => slot.equipmentId ? [slot.equipmentId] : []);
      default: return player[zone];
    }
  });
}

function evaluateCompatibleBondPredicate(condition: BondCondition, state: GameState, ruleset: Ruleset, player: PlayerState): boolean {
  switch (condition.kind) {
    case 'defeated-bosses-at-least': return player.history.defeatedBosses >= condition.amount;
    case 'defeated-monsters-at-least': return player.history.defeatedMonsters >= condition.amount;
    case 'counter-at-least': return (player.counters.find((counter) => counter.resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'completed-bonds-at-least': return player.bonds.filter((bond) => bond.completed).length >= condition.amount;
    case 'card-definition-present': return cardIdsInZones(player, condition.zones).some((cardId) => state.cards[cardId]?.definitionId === condition.definitionId);
    case 'card-type-present': return cardIdsInZones(player, condition.zones).some((cardId) => getDefinition(ruleset.registry, state, cardId).type === condition.cardType);
    case 'party-member-present': return player.party.some((slot) => !condition.definitionId || state.cards[slot.adventurerId]?.definitionId === condition.definitionId);
    case 'equipment-present': return player.party.some((slot) => slot.equipmentId && (!condition.definitionId || state.cards[slot.equipmentId]?.definitionId === condition.definitionId));
    case 'all': return condition.conditions.every((child) => evaluateCompatibleBondPredicate(child, state, ruleset, player));
    case 'any': return condition.conditions.some((child) => evaluateCompatibleBondPredicate(child, state, ruleset, player));
    case 'not': return !evaluateCompatibleBondPredicate(condition.condition, state, ruleset, player);
  }
}

/** A pure recursive predicate. It never mutates state or advances RNG. */
export function evaluateBondPredicate(condition: BondCondition, state: GameState, ruleset: Ruleset, player: PlayerState): boolean {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  return evaluateCompatibleBondPredicate(condition, state, ruleset, player);
}

function rulesForBond(ruleset: Ruleset, bondId: string): readonly BondConditionRule[] {
  return ruleset.modules.flatMap((module) => module.bondConditionRules ?? []).filter((rule) => rule.bondId === bondId);
}

function orderRules(rules: readonly BondConditionRule[]): BondEvaluationResult | readonly BondConditionRule[] {
  if (rules.length > 1 && (rules.some((rule) => rule.priority === undefined) || new Set(rules.map((rule) => rule.priority)).size !== rules.length)) {
    return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Bond condition ordering is ambiguous; every combined rule needs a unique explicit priority.' };
  }
  return [...rules].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
}

/**
 * Evaluates Rules Module data in explicit priority order.  Multiple rules are
 * intentionally an AND composition: each independently registered constraint
 * must hold.  With no registered rule we retain the old requiredBosses fixture
 * as an explicit mechanical compatibility adapter.
 */
export function evaluateBondCondition(state: GameState, ruleset: Ruleset, playerId: string, bondId: string): BondEvaluationResult {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) {
    return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  }
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return { status: 'failed', reason: 'UNKNOWN_PLAYER', error: `Unknown player: ${playerId}.` };
  const bond = ruleset.registry.bonds.find((candidate) => candidate.id === bondId);
  if (!bond) return { status: 'failed', reason: 'UNKNOWN_BOND', error: `Unknown bond: ${bondId}.` };

  const rules = rulesForBond(ruleset, bondId);
  for (const rule of rules) {
    const module = ruleset.modules.find((candidate) => candidate.id === rule.moduleId);
    if (!module) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: `Unknown BondCondition module: ${rule.moduleId}.` };
    if (!module.bondConditionRules?.some((candidate) => candidate.ruleId === rule.ruleId && candidate.moduleId === rule.moduleId)) {
      return { status: 'failed', reason: 'UNKNOWN_RULE', error: `Unknown BondCondition rule: ${rule.moduleId}/${rule.ruleId}.` };
    }
  }
  const ordered = orderRules(rules);
  if ('status' in ordered) return ordered;
  const satisfied = ordered.length > 0
    ? ordered.every((rule) => evaluateBondPredicate(rule.condition, state, ruleset, player))
    : player.history.defeatedBosses >= bond.requiredBosses;
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      satisfied,
      appliedRules: ordered.map(({ moduleId, ruleId }) => ({ moduleId, ruleId })),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }
    }
  };
}
