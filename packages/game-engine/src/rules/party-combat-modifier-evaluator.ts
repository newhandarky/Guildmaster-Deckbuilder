import { PartyCombatEvaluationInputSchema, type GameState, type PartyCombatCondition, type PartyCombatEvaluation, type PartyCombatEvaluationInput, type PartyCombatModifierRule } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
import { attachmentCombat } from './attachment-evaluator.js';
import { evaluateEquipmentCombatModifiers } from './equipment-combat-modifier-evaluator.js';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

export type PartyCombatEvaluationResult =
  | { status: 'ready'; evaluation: PartyCombatEvaluation }
  | { status: 'failed'; reason: 'INVALID_INPUT' | 'REGISTRY_VERSION_MISMATCH' | 'UNKNOWN_PLAYER' | 'UNKNOWN_TARGET' | 'INVALID_COMBAT_VALUE'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

function matches(condition: PartyCombatCondition, state: GameState, ruleset: Ruleset, input: PartyCombatEvaluationInput, sourceIndex: number, subjectIndex: number, partySize: number): boolean {
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
    case 'party-tag-count-at-least': return state.players.find(({ id }) => id === input.playerId)!.party
      .filter(({ adventurerId }) => condition.tags.some((tag) => getDefinition(ruleset.registry, state, adventurerId).tags?.includes(tag))).length >= condition.amount;
    case 'subject-tag-in': {
      const subject = state.players.find(({ id }) => id === input.playerId)!.party[subjectIndex];
      return Boolean(subject && condition.tags.some((tag) => getDefinition(ruleset.registry, state, subject.adventurerId).tags?.includes(tag)));
    }
    case 'all': return condition.conditions.every((child) => matches(child, state, ruleset, input, sourceIndex, subjectIndex, partySize));
    case 'any': return condition.conditions.some((child) => matches(child, state, ruleset, input, sourceIndex, subjectIndex, partySize));
    case 'not': return !matches(condition.condition, state, ruleset, input, sourceIndex, subjectIndex, partySize);
  }
}

function targets(rule: PartyCombatModifierRule, sourceIndex: number, subjectIndex: number): boolean {
  switch (rule.subject) {
    case 'source': return subjectIndex === sourceIndex;
    case 'other': return subjectIndex !== sourceIndex;
    case 'first': return subjectIndex === 0 && subjectIndex !== sourceIndex;
    case 'adjacent': return Math.abs(subjectIndex - sourceIndex) === 1;
    case 'all': return true;
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
    const attachmentIds = input.equipmentSuppressed ? [] : attachedCardIds(slot);
    let equipmentCombat = 0;
    for (const attachmentId of attachmentIds) {
      const definition = getDefinition(ruleset.registry, state, attachmentId);
      equipmentCombat += attachmentCombat(state, ruleset, input.playerId, slot.adventurerId, attachmentId);
      if (definition.type !== 'equipment') continue;
      const modifiers = evaluateEquipmentCombatModifiers(state, ruleset, { schemaVersion: 1, playerId: input.playerId, equipmentCardId: attachmentId, adventurerId: slot.adventurerId, ...(input.targetId ? { targetId: input.targetId } : {}) });
      if (modifiers.status === 'unsupported') return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: modifiers.error };
      if (modifiers.status === 'failed') return { status: 'failed', reason: modifiers.reason === 'INVALID_COMBAT_VALUE' ? 'INVALID_COMBAT_VALUE' : 'INVALID_INPUT', error: modifiers.error };
      equipmentCombat += modifiers.evaluation.powerBonus;
    }
    const appliedRules: PartyCombatEvaluation['members'][number]['appliedRules'][number][] = [];
    for (const rule of ordered) {
      player.party.forEach((sourceSlot, sourceIndex) => {
        if (!targets(rule, sourceIndex, subjectIndex) || !matches(rule.when, state, ruleset, input, sourceIndex, subjectIndex, player.party.length)) return;
        const sourceCardIds = [sourceSlot.adventurerId, ...(input.equipmentSuppressed ? [] : attachedCardIds(sourceSlot))]
          .filter((cardId) => rule.sourceDefinitionIds.includes(state.cards[cardId]!.definitionId));
        const amount = rule.amount.kind === 'fixed' ? rule.amount.value : rule.amount.value * Math.max(0, player.party.length - 1);
        for (const sourceCardId of sourceCardIds) appliedRules.push({ moduleId: rule.moduleId, ruleId: rule.ruleId, sourceCardId, amount });
      });
    }
    const printedCombat = adventurer.combat ?? 0;
    const modifierCombat = appliedRules.reduce((sum, rule) => sum + rule.amount, 0);
    const turnBonus = state.turnFacts?.playerId === input.playerId ? state.turnFacts.partyCombatBonuses?.find(({ definitionId }) => definitionId === adventurer.id)?.amount ?? 0 : 0;
    const subtotal = Math.max(0, printedCombat + equipmentCombat + modifierCombat + turnBonus);
    const multiplier = state.turnFacts?.playerId === input.playerId ? state.turnFacts.partyCombatMultipliers?.find(({ definitionId }) => definitionId === adventurer.id) : undefined;
    const effectiveCombat = multiplier ? Math.floor(subtotal * multiplier.numerator / multiplier.denominator) : subtotal;
    if (![printedCombat, equipmentCombat, modifierCombat, turnBonus, effectiveCombat].every(Number.isSafeInteger)) return { status: 'failed', reason: 'INVALID_COMBAT_VALUE', error: `Party combat overflowed for ${slot.adventurerId}.` };
    members.push({ adventurerId: slot.adventurerId, ...(attachmentIds.length === 1 ? { equipmentId: attachmentIds[0] } : {}), ...(attachmentIds.length > 1 ? { equipmentIds: attachmentIds } : {}), printedCombat, equipmentCombat, modifierCombat, effectiveCombat, appliedRules });
  }
  return { status: 'ready', evaluation: { schemaVersion: 1, members, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } } };
}
