import type { CombatCondition, CombatEvaluation, CombatRule, GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import { nextSeat } from '../model/seats.js';
import type { Ruleset } from './ruleset.js';
import { evaluateContinuousEffects } from './continuous-evaluator.js';
import { evaluatePartyCombat } from './party-combat-modifier-evaluator.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type CombatEvaluationResult =
  | { status: 'ready'; evaluation: CombatEvaluation }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string }
  | { status: 'failed'; reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH' | 'INVALID_TARGET' | 'INVALID_COMBAT_VALUE'; error: string };
export type CombatPartyPrefix = { slotCount: number; power: number; participantCardIds: readonly string[] };

function registryError(state: GameState, ruleset: Ruleset): Extract<CombatEvaluationResult, { status: 'failed' }> | undefined {
  if (state.rulesModules.some(({ id }) => !ruleset.modules.some((module) => module.id === id)) || ruleset.modules.some(({ id }) => !state.rulesModules.some((module) => module.id === id))) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: 'Combat Rules Module registry contains an unknown module.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  return undefined;
}

function matches(condition: CombatCondition, state: GameState, playerId: string, targetId: string): boolean {
  const target = state.enemyTargets[targetId];
  if (!target) return false;
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'phase-is': return state.phase === condition.phase;
    case 'target-kind-in': return condition.kinds.includes(target.kind);
    case 'target-definition-id-in': return condition.definitionIds.includes(state.cards[target.cardInstanceId]?.definitionId ?? '');
    case 'player-counter-at-least': return (getPlayer(state, playerId).counters.find(({ resourceId }) => resourceId === condition.resourceId)?.amount ?? 0) >= condition.amount;
    case 'all': return condition.conditions.every((child) => matches(child, state, playerId, targetId));
    case 'any': return condition.conditions.some((child) => matches(child, state, playerId, targetId));
    case 'not': return !matches(condition.condition, state, playerId, targetId);
  }
}

function order(rules: readonly CombatRule[]): readonly CombatRule[] | undefined {
  if (rules.length < 2) return rules;
  if (rules.some(({ priority }) => priority === undefined)) return undefined;
  const ordered = [...rules].sort((left, right) => left.priority! - right.priority!);
  if (ordered.some((rule, index) => index > 0 && rule.priority === ordered[index - 1]!.priority)) return undefined;
  return ordered;
}

function modifierAmount(rule: Extract<CombatRule, { kind: 'modifier' }>, state: GameState, ruleset: Ruleset, playerId: string): number | undefined {
  if (typeof rule.amount === 'number') return rule.amount;
  const amount = rule.amount;
  if (amount.kind === 'public-zone-card-count') {
    const zone = state.zones[amount.zoneId];
    if (!zone || zone.visibility !== 'public') return undefined;
    return zone.cardIds.filter((cardId) => amount.definitionTypes.includes(getDefinition(ruleset.registry, state, cardId).type)).length * amount.multiplier;
  }
  const player = amount.player === 'attacking-player' ? getPlayer(state, playerId) : nextSeat(state.players, playerId);
  const tags = new Set(player.party.flatMap(({ adventurerId }) => getDefinition(ruleset.registry, state, adventurerId).tags?.filter((tag) => tag.startsWith(amount.tagPrefix)) ?? []));
  return tags.size * amount.multiplier;
}

/** Pure, deterministic combat evaluation shared by queries and authoritative dispatch. */
export function evaluateCombat(state: GameState, ruleset: Ruleset, playerId: string, targetId: string): CombatEvaluationResult {
  const continuous = evaluateContinuousEffects(state, ruleset); if (continuous.status !== 'ready') return { status: continuous.status, reason: continuous.reason as 'ORDER_POLICY_REQUIRED', error: continuous.error } as CombatEvaluationResult;
  const mismatch = registryError(state, ruleset);
  if (mismatch) return mismatch;
  const target = state.enemyTargets[targetId];
  if (!target) return { status: 'failed', reason: 'INVALID_TARGET', error: `Unknown combat target: ${targetId}.` };
  const active = ruleset.modules.flatMap((module) => module.combatRules ?? []).filter((rule) => matches(rule.when, state, playerId, targetId));
  const ordered = order(active);
  if (!ordered) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Active combat rules require distinct explicit priorities.' };
  const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
  if (definition.combat === undefined || !Number.isFinite(definition.combat)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Combat target ${targetId} has no finite combat requirement.` };
  let requiredCombat = definition.combat + continuous.evaluation.active.filter((effect) => effect.target === 'combat-modifier').reduce((sum, effect) => sum + effect.amount, 0);
  const restrictions: string[] = [];
  const equipmentSuppressionReasonCodes: string[] = [];
  let maximumPartySlots: number | undefined;
  let participantLimitReasonCode: string | undefined;
  let outcome: CombatEvaluation['outcome'] = { kind: 'defeat-target' };
  for (const rule of ordered) {
    if (rule.kind === 'modifier') {
      const amount = modifierAmount(rule, state, ruleset, playerId);
      if (amount === undefined) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Combat modifier ${rule.moduleId}/${rule.ruleId} references unavailable public data.` };
      requiredCombat += amount;
      if (!Number.isFinite(requiredCombat)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Combat modifiers overflowed the requirement for target ${targetId}.` };
    }
    if (rule.kind === 'restriction') restrictions.push(rule.reasonCode);
    if (rule.kind === 'equipment-suppression') equipmentSuppressionReasonCodes.push(rule.reasonCode);
    if (rule.kind === 'participant-limit' && (maximumPartySlots === undefined || rule.maximumPartySlots < maximumPartySlots)) {
      maximumPartySlots = rule.maximumPartySlots;
      participantLimitReasonCode = rule.reasonCode;
    }
    if (rule.kind === 'replacement') outcome = rule.outcome;
  }
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      requiredCombat: Math.max(0, requiredCombat),
      eligible: restrictions.length === 0,
      ...(maximumPartySlots === undefined ? {} : { maximumPartySlots }),
      ...(participantLimitReasonCode === undefined ? {} : { participantLimitReasonCode }),
      equipmentSuppressed: equipmentSuppressionReasonCodes.length > 0,
      equipmentSuppressionReasonCodes,
      restrictionReasonCodes: restrictions,
      outcome,
      appliedRules: ordered.map((rule) => ({ moduleId: rule.moduleId, ruleId: rule.ruleId })),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }
    }
  };
}

/** Fixes the exact ordered party prefix consumed by one authoritative attack. */
export function evaluateCombatPartyPrefix(state: GameState, ruleset: Ruleset, playerId: string, requiredCombat: number, targetId?: string, maximumPartySlots?: number, equipmentSuppressed = false): CombatPartyPrefix | undefined {
  if (validateRulesetStateCompatibility(state, ruleset)) return undefined;
  if (!Number.isFinite(requiredCombat) || requiredCombat < 0) return undefined;
  const player = getPlayer(state, playerId);
  const partyCombat = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId, ...(targetId ? { targetId } : {}), ...(equipmentSuppressed ? { equipmentSuppressed: true } : {}) });
  if (partyCombat.status !== 'ready') return undefined;
  let power = player.turnCombatBonus;
  if (!Number.isFinite(power)) return undefined;
  if (power >= requiredCombat) return { slotCount: 0, power, participantCardIds: [] };
  const participantCardIds: string[] = [];
  const partySlots = Math.min(player.party.length, maximumPartySlots ?? player.party.length);
  for (let index = 0; index < partySlots; index += 1) {
    const slot = player.party[index]!;
    participantCardIds.push(slot.adventurerId);
    power += partyCombat.evaluation.members[index]!.effectiveCombat;
    if (slot.equipmentId) participantCardIds.push(slot.equipmentId);
    if (!Number.isFinite(power)) return undefined;
    if (power >= requiredCombat) return { slotCount: index + 1, power, participantCardIds };
  }
  return undefined;
}
