import type { GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { evaluateCombat } from './combat-evaluator.js';
import type { CardEffectActivationPolicy, Ruleset } from './ruleset.js';

export type CardEffectActivationEvaluation = {
  policy: CardEffectActivationPolicy;
  sourceCardId: string;
  targetId: string;
  targetCardId: string;
  requiredCombatBefore: number;
  requiredCombatAfter: number;
  modifierAmount: number;
};

export function evaluateCardEffectActivation(
  state: GameState,
  ruleset: Ruleset,
  playerId: string,
  sourceCardId: string,
  targetId: string,
): CardEffectActivationEvaluation | undefined {
  if (state.phase !== 'combat') return undefined;
  const player = state.players.find(({ id }) => id === playerId);
  const sourceSlot = player?.party.find(({ adventurerId }) => adventurerId === sourceCardId);
  const target = state.enemyTargets[targetId];
  if (!sourceSlot || !target || target.status !== 'available') return undefined;
  if (target.kind !== 'monster' && target.kind !== 'boss') return undefined;
  const targetKind = target.kind;
  const sourceDefinition = getDefinition(ruleset.registry, state, sourceCardId);
  const policies = ruleset.modules.flatMap((module) => module.cardEffectActivationPolicies ?? [])
    .filter((policy) => policy.phase === state.phase && policy.sourceDefinitionIds.includes(sourceDefinition.id) && policy.targetKinds.includes(targetKind))
    .sort((left, right) => right.priority - left.priority || left.moduleId.localeCompare(right.moduleId) || left.policyId.localeCompare(right.policyId));
  if (policies.length !== 1) return undefined;
  const combat = evaluateCombat(state, ruleset, playerId, targetId);
  if (combat.status !== 'ready') return undefined;
  const policy = policies[0]!;
  const divided = combat.evaluation.requiredCombat / policy.combatModifier.divisor;
  const requiredCombatAfter = policy.combatModifier.rounding === 'ceil' ? Math.ceil(divided) : Math.floor(divided);
  return {
    policy,
    sourceCardId,
    targetId,
    targetCardId: target.cardInstanceId,
    requiredCombatBefore: combat.evaluation.requiredCombat,
    requiredCombatAfter,
    modifierAmount: requiredCombatAfter - combat.evaluation.requiredCombat,
  };
}
