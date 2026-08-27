import type { BondCompletionTiming, BondCondition, BondConditionRule, BondEvaluation, BondPlayerZone, GameState, PlayerState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
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
      case 'equipment': return player.party.flatMap(attachedCardIds);
      default: return player[zone];
    }
  });
}

function evaluateCompatibleBondPredicate(condition: BondCondition, state: GameState, ruleset: Ruleset, player: PlayerState): boolean {
  const partyDefinitions = () => player.party.map(({ adventurerId }) => getDefinition(ruleset.registry, state, adventurerId));
  const tagsFor = (definition: ReturnType<typeof getDefinition>, prefix?: string) => (definition.tags ?? []).filter((tag) => !prefix || tag.startsWith(prefix));
  switch (condition.kind) {
    case 'defeated-bosses-at-least': return player.history.defeatedBosses >= condition.amount;
    case 'defeated-monsters-at-least': return player.history.defeatedMonsters >= condition.amount;
    case 'counter-at-least': return (player.counters.find((counter) => counter.resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'completed-bonds-at-least': return player.bonds.filter((bond) => bond.completed).length >= condition.amount;
    case 'card-definition-present': return cardIdsInZones(player, condition.zones).some((cardId) => state.cards[cardId]?.definitionId === condition.definitionId);
    case 'card-type-present': return cardIdsInZones(player, condition.zones).some((cardId) => getDefinition(ruleset.registry, state, cardId).type === condition.cardType);
    case 'party-member-present': return player.party.some((slot) => !condition.definitionId || state.cards[slot.adventurerId]?.definitionId === condition.definitionId);
    case 'equipment-present': return player.party.some((slot) => attachedCardIds(slot).some((cardId) => !condition.definitionId || state.cards[cardId]?.definitionId === condition.definitionId));
    case 'phase-is': return state.phase === condition.phase;
    case 'turn-fact-at-least': {
      if (state.turnFacts?.playerId !== player.id) return false;
      const value = state.turnFacts[condition.fact];
      return typeof value === 'number' && value >= condition.amount;
    }
    case 'turn-fact-distinct-values-at-least': {
      if (state.turnFacts?.playerId !== player.id) return false;
      return new Set(state.turnFacts[condition.fact] ?? []).size >= condition.amount;
    }
    case 'party-size-between': return player.party.length >= condition.minimum && player.party.length <= condition.maximum;
    case 'party-tag-count-at-least': return partyDefinitions().filter((definition) => condition.tags.some((tag) => definition.tags?.includes(tag))).length >= condition.amount;
    case 'party-edge-tags': {
      if (player.party.length < condition.count) return false;
      const selected = condition.edge === 'first' ? partyDefinitions().slice(0, condition.count) : partyDefinitions().slice(-condition.count);
      return selected.every((definition) => condition.tags.some((tag) => definition.tags?.includes(tag)));
    }
    case 'party-distinct-tag-count-at-least': {
      const definitions = partyDefinitions().filter((definition) => !condition.nonStarterOnly || definition.type !== 'starter');
      return new Set(definitions.flatMap((definition) => tagsFor(definition, condition.tagPrefix))).size >= condition.amount;
    }
    case 'party-nonstarter-count-at-least': return partyDefinitions().filter(({ type }) => type !== 'starter').length >= condition.amount;
    case 'party-all-tags-in': return player.party.length >= condition.minimum && partyDefinitions().every((definition) => condition.tags.some((tag) => definition.tags?.includes(tag)));
    case 'party-same-tag-count-at-least': {
      if (condition.requireAll && player.party.length < condition.amount) return false;
      const counts = new Map<string, number>();
      for (const definition of partyDefinitions()) for (const tag of tagsFor(definition, condition.tagPrefix)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return condition.requireAll
        ? [...counts.values()].some((count) => count === player.party.length)
        : [...counts.values()].some((count) => count >= condition.amount);
    }
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

export function bondCompletionTimingFor(ruleset: Ruleset, bondId: string): BondCompletionTiming {
  const timings = new Set(rulesForBond(ruleset, bondId).map(({ completionTiming }) => completionTiming ?? 'state'));
  if (timings.size > 1) throw new Error(`Bond ${bondId} has conflicting completion timing policies.`);
  return [...timings][0] ?? 'state';
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
