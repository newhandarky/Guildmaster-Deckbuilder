import type { CombatAssistPolicy, CombatEvaluation, GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { evaluateCombat, evaluateCombatPartyPrefix, type CombatPartyPrefix } from './combat-evaluator.js';
import type { Ruleset } from './ruleset.js';

export type CombatAssistEvaluation = {
  policy: CombatAssistPolicy;
  sourceCardId: string;
  combat: CombatEvaluation;
  partyPrefix: CombatPartyPrefix;
};

/** Public/static eligibility used when command-before preview is indeterminate. */
export function combatAssistCanTarget(state: GameState, ruleset: Ruleset, playerId: string, targetId: string, sourceCardId: string): boolean {
  const player = getPlayer(state, playerId);
  const target = state.enemyTargets[targetId];
  if (!player.party.some(({ adventurerId }) => adventurerId === sourceCardId) || !target || target.status !== 'available' || target.health) return false;
  const definitionId = state.cards[sourceCardId]?.definitionId;
  return ruleset.modules.flatMap((module) => module.combatAssistPolicies ?? []).some((policy) =>
    policy.sourceDefinitionIds.includes(definitionId ?? '') && policy.targetKinds.includes(target.kind as 'monster' | 'boss'));
}

/** Pure evaluation shared by legal commands, previews, CPU features and dispatch. */
export function evaluateCombatAssist(state: GameState, ruleset: Ruleset, playerId: string, targetId: string, sourceCardId: string): CombatAssistEvaluation | undefined {
  const player = getPlayer(state, playerId);
  const sourceIndex = player.party.findIndex(({ adventurerId }) => adventurerId === sourceCardId);
  const target = state.enemyTargets[targetId];
  if (sourceIndex < 0 || !combatAssistCanTarget(state, ruleset, playerId, targetId, sourceCardId) || !target) return undefined;
  const definitionId = state.cards[sourceCardId]?.definitionId;
  const policies = ruleset.modules.flatMap((module) => module.combatAssistPolicies ?? [])
    .filter((policy) => policy.sourceDefinitionIds.includes(definitionId ?? '') && policy.targetKinds.includes(target.kind as 'monster' | 'boss'))
    .sort((left, right) => left.priority - right.priority);
  if (policies.length !== 1) return undefined;
  const base = evaluateCombat(state, ruleset, playerId, targetId);
  if (base.status !== 'ready' || !base.evaluation.eligible) return undefined;
  const policy = policies[0]!;
  const requiredCombat = Math.ceil(base.evaluation.requiredCombat / policy.requiredCombat.divisor);
  const combat: CombatEvaluation = {
    ...structuredClone(base.evaluation), requiredCombat,
    appliedRules: [...base.evaluation.appliedRules, { moduleId: policy.moduleId, ruleId: policy.policyId }],
  };
  const partyPrefix = evaluateCombatPartyPrefix(state, ruleset, playerId, requiredCombat, targetId, combat.maximumPartySlots, combat.equipmentSuppressed);
  if (!partyPrefix || sourceIndex < partyPrefix.slotCount) return undefined;
  return { policy, sourceCardId, combat, partyPrefix };
}
