import type { CombatCondition, CombatEvaluation, CombatRule, GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import type { Ruleset } from './ruleset.js';
import { evaluateContinuousEffects } from './continuous-evaluator.js';

export type CombatEvaluationResult =
  | { status: 'ready'; evaluation: CombatEvaluation }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string }
  | { status: 'failed'; reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH' | 'INVALID_TARGET' | 'INVALID_COMBAT_VALUE'; error: string };

function registryError(state: GameState, ruleset: Ruleset): Extract<CombatEvaluationResult, { status: 'failed' }> | undefined {
  const stateSignature = state.rulesModules.map(({ id, version }) => `${id}@${version}`).join('|');
  const rulesetSignature = ruleset.modules.map(({ id, version }) => `${id}@${version}`).join('|');
  if (state.rulesModules.some(({ id }) => !ruleset.modules.some((module) => module.id === id)) || ruleset.modules.some(({ id }) => !state.rulesModules.some((module) => module.id === id))) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: 'Combat Rules Module registry contains an unknown module.' };
  if (stateSignature !== rulesetSignature) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: 'Combat Rules Module registry version mismatch.' };
  return undefined;
}

function matches(condition: CombatCondition, state: GameState, playerId: string, targetId: string): boolean {
  const target = state.enemyTargets[targetId];
  if (!target) return false;
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'phase-is': return state.phase === condition.phase;
    case 'target-kind-in': return condition.kinds.includes(target.kind);
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
  let outcome: CombatEvaluation['outcome'] = { kind: 'defeat-target' };
  for (const rule of ordered) {
    if (rule.kind === 'modifier') {
      requiredCombat += rule.amount;
      if (!Number.isFinite(requiredCombat)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Combat modifiers overflowed the requirement for target ${targetId}.` };
    }
    if (rule.kind === 'restriction') restrictions.push(rule.reasonCode);
    if (rule.kind === 'replacement') outcome = rule.outcome;
  }
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      requiredCombat: Math.max(0, requiredCombat),
      eligible: restrictions.length === 0,
      restrictionReasonCodes: restrictions,
      outcome,
      appliedRules: ordered.map((rule) => ({ moduleId: rule.moduleId, ruleId: rule.ruleId })),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }
    }
  };
}
