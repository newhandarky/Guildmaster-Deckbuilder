import type { CommandEnvelope, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import type { Ruleset } from '../rules/ruleset.js';
import { baseZoneIds } from '../model/zones.js';
import { evaluateCombat } from '../rules/combat-evaluator.js';
import { evaluateEquipmentEligibility } from '../rules/equipment-eligibility-evaluator.js';
import { dispatchLifecycle, resumeLifecycleChoice } from '../effects/lifecycle-dispatcher.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';
import { evaluateMonsterDefeatContinuity, validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';

const maxAttackPreviewDepth = 32;
const maxAttackPreviewBranches = 256;
type AttackPreviewResult = { states: GameState[]; indeterminate: boolean };

function expandAttackChoicePreviews(state: GameState, ruleset: Ruleset, actorId: string, depth: number, budget: { remaining: number }): AttackPreviewResult {
  const choice = state.effectState.pendingChoice;
  if (!choice || choice.actorId !== actorId) return { states: [], indeterminate: false };
  if (depth >= maxAttackPreviewDepth) return { states: [], indeterminate: true };
  const completed: GameState[] = [];
  let indeterminate = false;
  for (const option of choice.options) {
    if (budget.remaining <= 0) { indeterminate = true; break; }
    budget.remaining -= 1;
    const branch = structuredClone(state);
    const result = resumeLifecycleChoice(branch, ruleset, actorId, choice.executionId, choice.choiceId, option.id);
    if (result.status === 'completed') completed.push(branch);
    else if (result.status === 'suspended') {
      if (branch.effectState.pendingCounterConsent) {
        indeterminate = true;
        continue;
      }
      const nested = expandAttackChoicePreviews(branch, ruleset, actorId, depth + 1, budget);
      completed.push(...nested.states); indeterminate ||= nested.indeterminate;
    }
  }
  return { states: completed, indeterminate };
}

function resumeAttackChoicePreview(state: GameState, ruleset: Ruleset, actorId: string, optionId: string): AttackPreviewResult {
  const choice = state.effectState.pendingChoice;
  if (!choice || choice.actorId !== actorId) return { states: [], indeterminate: false };
  const branch = structuredClone(state);
  const result = resumeLifecycleChoice(branch, ruleset, actorId, choice.executionId, choice.choiceId, optionId);
  if (result.status === 'completed') return { states: [branch], indeterminate: false };
  if (result.status === 'suspended' && branch.effectState.pendingCounterConsent) return { states: [], indeterminate: true };
  return result.status === 'suspended' ? expandAttackChoicePreviews(branch, ruleset, actorId, 1, { remaining: maxAttackPreviewBranches }) : { states: [], indeterminate: false };
}

function previewAttackCommandBefore(state: GameState, ruleset: Ruleset, actorId: string): AttackPreviewResult {
  const preview = structuredClone(state);
  const result = dispatchLifecycle(preview, ruleset, { schemaVersion: 1, point: 'command-before', actorId, commandType: 'ATTACK_TARGET', phase: preview.phase, metadata: { commandId: `legal-preview-${state.revision + 1}` } }, { controllerId: actorId });
  if (result.status === 'completed') return { states: [preview], indeterminate: false };
  if (result.status === 'suspended' && preview.effectState.pendingCounterConsent) return { states: [], indeterminate: true };
  return result.status === 'suspended' ? expandAttackChoicePreviews(preview, ruleset, actorId, 0, { remaining: maxAttackPreviewBranches }) : { states: [], indeterminate: false };
}

function attackIsLegalInAnyPreview(preview: AttackPreviewResult, ruleset: Ruleset, actorId: string, targetId: string): boolean {
  if (preview.indeterminate) return true;
  return preview.states.some((state) => {
    const target = state.enemyTargets[targetId];
    const encounter = target?.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
    if (!target || target.status !== 'available' || encounter?.status === 'finished' || target.health) return false;
    const result = evaluateCombat(state, ruleset, actorId, targetId);
    if (result.status !== 'ready' || !result.evaluation.eligible) return false;
    if (target.kind === 'monster' && evaluateMonsterDefeatContinuity(state, ruleset, targetId, result.evaluation.outcome.kind).status !== 'ready') return false;
    return getCombatPrefix(state, ruleset, actorId, result.evaluation.requiredCombat) !== undefined;
  });
}

export function getPurchasePower(state: GameState, ruleset: Ruleset, playerId: string): number {
  const player = getPlayer(state, playerId);
  const handPower = player.hand.reduce((sum, cardId) => sum + (getDefinition(ruleset.registry, state, cardId).purchasePower ?? 0), 0);
  return handPower + player.turnPurchaseBonus - player.turnPurchaseSpent;
}

export function getCombatPrefix(state: GameState, ruleset: Ruleset, playerId: string, required: number): { slotCount: number; power: number } | undefined {
  const player = getPlayer(state, playerId);
  let power = player.turnCombatBonus;
  if (power >= required) return { slotCount: 0, power };
  for (let index = 0; index < player.party.length; index += 1) {
    const slot = player.party[index]!;
    power += getDefinition(ruleset.registry, state, slot.adventurerId).combat ?? 0;
    if (slot.equipmentId) power += getDefinition(ruleset.registry, state, slot.equipmentId).combat ?? 0;
    if (power >= required) return { slotCount: index + 1, power };
  }
  return undefined;
}

export function getLegalCommands(state: GameState, ruleset: Ruleset, actorId: string): GameCommand[] {
  if (state.status !== 'playing' && state.status !== 'finalRound') return [];
  if (validateSupplyContinuityState(state, ruleset).length) return [];
  const consent = state.effectState.pendingCounterConsent;
  if (consent) {
    if (!state.players.some(({ id }) => id === actorId)) return [];
    const candidates: GameCommand[] = [
      { type: 'RESPOND_COUNTER_CONSENT', requestId: consent.requestId, response: 'accept' },
      { type: 'RESPOND_COUNTER_CONSENT', requestId: consent.requestId, response: 'decline' },
      { type: 'CANCEL_COUNTER_CONSENT', requestId: consent.requestId },
      { type: 'EXPIRE_COUNTER_CONSENT', requestId: consent.requestId }
    ];
    return candidates.filter((command) => {
      const action = command.type === 'RESPOND_COUNTER_CONSENT' ? command.response : command.type === 'CANCEL_COUNTER_CONSENT' ? 'cancel' : 'expire';
      return evaluateCounterConsent(state, ruleset, { schemaVersion: 1, action, actorId, requestId: consent.requestId, registry: consent.registry }).status === 'ready';
    });
  }
  const pending = state.effectState.pendingChoice;
  if (pending) {
    if (pending.actorId !== actorId) return [];
    const pendingAttack = state.effectState.pendingCommand?.envelope.command;
    const options = pendingAttack?.type === 'ATTACK_TARGET' && state.effectState.pendingCommand?.kind !== 'combat-reward'
      ? pending.options.filter((option) => attackIsLegalInAnyPreview(resumeAttackChoicePreview(state, ruleset, actorId, option.id), ruleset, actorId, pendingAttack.targetId))
      : pending.options;
    return options.map((option) => ({ type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: option.id }));
  }
  if (state.activePlayerId !== actorId) return [];
  const player = getPlayer(state, actorId);
  const commands: GameCommand[] = [];
  if (state.phase === 'action1' || state.phase === 'action2') {
    for (const cardId of player.hand) {
      const definition = getDefinition(ruleset.registry, state, cardId);
      if (definition.type === 'adventurer') commands.push({ type: 'PLAY_ADVENTURER', cardId });
      if (definition.type === 'item') commands.push({ type: 'USE_ITEM', cardId });
      if (definition.type === 'equipment') for (const slot of player.party) {
        const eligibility = evaluateEquipmentEligibility(state, ruleset, { schemaVersion: 1, playerId: actorId, equipmentCardId: cardId, adventurerId: slot.adventurerId });
        if (eligibility.status === 'ready' && eligibility.evaluation.eligible) commands.push({ type: 'EQUIP_ITEM', cardId, adventurerId: slot.adventurerId });
      }
    }
  }
  if (state.phase === 'combat') {
    const preview = previewAttackCommandBefore(state, ruleset, actorId);
    for (const target of Object.values(state.enemyTargets)) {
      if (target.status !== 'available') continue;
      if (target.kind === 'monster' && evaluateMonsterDefeatContinuity(state, ruleset, target.targetId).status !== 'ready') continue;
      if (attackIsLegalInAnyPreview(preview, ruleset, actorId, target.targetId)) commands.push({ type: 'ATTACK_TARGET', targetId: target.targetId });
    }
  }
  if (state.phase === 'purchase') {
    const power = getPurchasePower(state, ruleset, actorId);
    for (const cardId of [...state.zones[baseZoneIds.adventurerRow]!.cardIds, ...state.zones[baseZoneIds.itemRow]!.cardIds]) {
      if ((getDefinition(ruleset.registry, state, cardId).cost ?? Number.POSITIVE_INFINITY) <= power) commands.push({ type: 'BUY_CARD', cardId });
    }
  }
  commands.push({ type: 'END_PHASE', phase: state.phase });
  return commands;
}

export function envelope(state: GameState, actorId: string, command: GameCommand, commandId = `legal-${state.revision + 1}`): CommandEnvelope {
  return { protocolVersion: 1, gameId: state.gameId, commandId, actorId, expectedRevision: state.revision, command };
}
