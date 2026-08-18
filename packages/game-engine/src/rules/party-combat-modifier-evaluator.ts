import { PartyCombatEvaluationInputSchema, type GameState, type PartyCombatCondition, type PartyCombatEvaluation, type PartyCombatEvaluationInput, type PartyCombatModifierRule } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { evaluateEquipmentCombatModifiers } from './equipment-combat-modifier-evaluator.js';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

export type PartyCombatEvaluationResult =
  | { status: 'ready'; evaluation: PartyCombatEvaluation }
  | { status: 'failed'; reason: 'INVALID_INPUT' | 'REGISTRY_VERSION_MISMATCH' | 'UNKNOWN_PLAYER' | 'UNKNOWN_TARGET' | 'INVALID_COMBAT_VALUE'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

function matches(condition: PartyCombatCondition, state: GameState, input: PartyCombatEvaluationInput, sourceIndex: number, subjectIndex: number, partySize: number): boolean {
  switch (condition.kind) {
    case 'always': return condition.value;
    case 'phase-is': return state.phase === condition.phase;
    case 'target-kind-in': {
      const target = input.targetId ? state.enemyTargets[input.targetId] : undefined;
      return target !== undefined && condition.kinds.some((kind) => kind === target.kind);
    }
    case 'source-position-in': return condition.positions.includes(sourceIndex + 1);
    case 'subject-position-in': return condition.positions.includes(subjectIndex + 1);
    case 'party-size-at-least': return partySize >= condition.amount;
    case 'all': return condition.conditions.every((child) => matches(child, state, input, sourceIndex, subjectIndex, partySize));
    case 'any': return condition.conditions.some((child) => matches(child, state, input, sourceIndex, subjectIndex, partySize));
    case 'not': return !matches(condition.condition, state, input, sourceIndex, subjectIndex, partySize);
  }
}

function targets(rule: PartyCombatModifierRule, sourceIndex: number, subjectIndex: number): boolean {
  switch (rule.subject) {
    case 'source': return subjectIndex === sourceIndex;
    case 'other': return subjectIndex !== sourceIndex;
    case 'first': return subjectIndex === 0 && subjectIndex !== sourceIndex;
    case 'adjacent': return Math.abs(subjectIndex - sourceIndex) === 1;
  }
}

/** Computes clamped, per-member party combat from JSON-only Rules Module policies. */
export function evaluatePartyCombat(state: GameState, ruleset: Ruleset, input: PartyCombatEvaluationInput): PartyCombatEvaluationResult {
  if (!PartyCombatEvaluationInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Party combat input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const player = state.players.find(({ id }) => id === input.playerId);
  if (!player) return { status: 'failed', reason: 'UNKNOWN_PLAYER', error: `Unknown party combat player ${input.playerId}.` };
  if (input.targetId !== undefined && !state.enemyTargets[input.targetId]) return { status: 'failed', reason: 'UNKNOWN_TARGET', error: `Unknown party combat target ${input.targetId}.` };
  const rules = ruleset.modules.flatMap((module) => module.partyCombatModifierRules ?? []);
  const ordered = [...rules].sort((left, right) => left.priority - right.priority);
  if (ordered.some((rule, index) => index > 0 && rule.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Party combat modifier rules require distinct priorities.' };

  const members: PartyCombatEvaluation['members'][number][] = [];
  for (let subjectIndex = 0; subjectIndex < player.party.length; subjectIndex += 1) {
    const slot = player.party[subjectIndex]!;
    const adventurer = getDefinition(ruleset.registry, state, slot.adventurerId);
    const equipment = slot.equipmentId && !input.equipmentSuppressed ? getDefinition(ruleset.registry, state, slot.equipmentId) : undefined;
    const equipmentModifiers = slot.equipmentId && !input.equipmentSuppressed
      ? evaluateEquipmentCombatModifiers(state, ruleset, { schemaVersion: 1, playerId: input.playerId, equipmentCardId: slot.equipmentId, adventurerId: slot.adventurerId })
      : undefined;
    if (equipmentModifiers?.status === 'unsupported') return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: equipmentModifiers.error };
    if (equipmentModifiers?.status === 'failed') return { status: 'failed', reason: equipmentModifiers.reason === 'INVALID_COMBAT_VALUE' ? 'INVALID_COMBAT_VALUE' : 'INVALID_INPUT', error: equipmentModifiers.error };
    const appliedRules: PartyCombatEvaluation['members'][number]['appliedRules'][number][] = [];
    for (const rule of ordered) {
      player.party.forEach((sourceSlot, sourceIndex) => {
        if (!rule.sourceDefinitionIds.includes(state.cards[sourceSlot.adventurerId]!.definitionId) || !targets(rule, sourceIndex, subjectIndex) || !matches(rule.when, state, input, sourceIndex, subjectIndex, player.party.length)) return;
        const amount = rule.amount.kind === 'fixed' ? rule.amount.value : rule.amount.value * Math.max(0, player.party.length - 1);
        appliedRules.push({ moduleId: rule.moduleId, ruleId: rule.ruleId, sourceCardId: sourceSlot.adventurerId, amount });
      });
    }
    const printedCombat = adventurer.combat ?? 0;
    const equipmentCombat = (equipment?.combat ?? 0) + (equipmentModifiers?.evaluation.powerBonus ?? 0);
    const modifierCombat = appliedRules.reduce((sum, rule) => sum + rule.amount, 0);
    const effectiveCombat = Math.max(0, printedCombat + equipmentCombat + modifierCombat);
    if (![printedCombat, equipmentCombat, modifierCombat, effectiveCombat].every(Number.isSafeInteger)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Party combat overflowed for ${slot.adventurerId}.` };
    members.push({ adventurerId: slot.adventurerId, ...(slot.equipmentId ? { equipmentId: slot.equipmentId } : {}), printedCombat, equipmentCombat, modifierCombat, effectiveCombat, appliedRules });
  }
  return { status: 'ready', evaluation: { schemaVersion: 1, members, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } } };
}
