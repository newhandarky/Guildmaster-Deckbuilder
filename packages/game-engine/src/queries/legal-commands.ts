import { ActionPreviewSetSchema, type ActionPreviewItem, type ActionPreviewSet, type AttackResolutionCondition, type AttackResolutionResult, type CombatRewardCondition, type CommandEnvelope, type GameCommand, type GameState } from '@guildmaster/game-protocol';
import { getDefinition, getPlayer } from '../model/factories.js';
import type { Ruleset } from '../rules/ruleset.js';
import { baseZoneIds } from '../model/zones.js';
import { evaluateCombat, evaluateCombatPartyPrefix } from '../rules/combat-evaluator.js';
import { evaluateEquipmentEligibility } from '../rules/equipment-eligibility-evaluator.js';
import { dispatchLifecycle, inspectLifecyclePreviewUncertainty, inspectPendingLifecyclePreviewUncertainty, resumeLifecycleChoice } from '../effects/lifecycle-dispatcher.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';
import { evaluateMonsterDefeatContinuity, validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { evaluateAttackResolution } from '../rules/attack-resolution-evaluator.js';
import { inspectContinuousPreviewUncertainty } from '../rules/continuous-evaluator.js';
import { evaluateCombatRewards } from '../rules/combat-reward-evaluator.js';

const maxCommandPreviewDepth = 32;
const maxCommandPreviewBranches = 256;
type CommandBeforePreviewResult = { states: GameState[]; indeterminate: boolean; requiresLifecycle: boolean };

function attackPreviewObservesHiddenInformation(state: GameState, ruleset: Ruleset, actorId: string, targetId: string): boolean {
  const target = state.enemyTargets[targetId];
  const encounter = target?.parentEncounterId ? state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId) : undefined;
  return inspectContinuousPreviewUncertainty(state, ruleset, actorId).observesHiddenInformation
    || Boolean(target?.parentEncounterId && (target.health || !encounter || encounter.resolutionPolicy))
    || combatRewardPreviewRequiresLifecycle(state, ruleset, actorId, targetId);
}

function rewardConditionObservesEncounterKind(condition: CombatRewardCondition): boolean {
  if (condition.kind === 'encounter-kind-in') return true;
  if (condition.kind === 'all' || condition.kind === 'any') return condition.conditions.some(rewardConditionObservesEncounterKind);
  return condition.kind === 'not' && rewardConditionObservesEncounterKind(condition.condition);
}

function combatRewardPreviewRequiresLifecycle(state: GameState, ruleset: Ruleset, actorId: string, targetId: string): boolean {
  const target = state.enemyTargets[targetId];
  if (!target) return false;
  if (target.parentEncounterId && ruleset.modules.flatMap((module) => module.combatRewardPolicies ?? []).some(({ condition }) => rewardConditionObservesEncounterKind(condition))) return true;
  const rewards = evaluateCombatRewards(state, ruleset, actorId, targetId);
  return rewards.status !== 'ready' || rewards.evaluation.matchedPolicies.length > 0;
}

function encounterKindsIn(condition: AttackResolutionCondition): string[] {
  if (condition.kind === 'encounter-kind-in') return [...condition.kinds];
  if (condition.kind === 'all' || condition.kind === 'any') return condition.conditions.flatMap(encounterKindsIn);
  return condition.kind === 'not' ? encounterKindsIn(condition.condition) : [];
}

function failedHealthAttackMayDependOnHiddenEncounter(state: GameState, ruleset: Ruleset, actorId: string, targetId: string, result: Exclude<AttackResolutionResult, { status: 'ready' }>): boolean {
  const target = state.enemyTargets[targetId];
  if (!target?.parentEncounterId) return false;
  if (result.reason === 'INVALID_ENCOUNTER_DAMAGE') return true;
  const encounter = state.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId);
  if (!encounter) return true;
  const registeredKinds = ruleset.modules.flatMap((module) => module.attackResolutionPolicies ?? []).flatMap(({ when }) => encounterKindsIn(when));
  let unmatchedKind = '__no_registered_encounter_kind__';
  while (registeredKinds.includes(unmatchedKind)) unmatchedKind += '_';
  const candidates = [...new Set([encounter.kind, ...registeredKinds, unmatchedKind])];
  return candidates.some((kind) => {
    const candidate = structuredClone(state);
    const candidateEncounter = candidate.enemyEncounters.find(({ encounterId }) => encounterId === target.parentEncounterId)!;
    candidateEncounter.kind = kind;
    candidateEncounter.status = 'active';
    return evaluateAttackResolution(candidate, ruleset, { schemaVersion: 1, playerId: actorId, targetId, registry: { rulesetVersion: candidate.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }).status === 'ready';
  });
}

function expandCommandChoicePreviews(state: GameState, ruleset: Ruleset, actorId: string, depth: number, budget: { remaining: number }): CommandBeforePreviewResult {
  const uncertainty = inspectPendingLifecyclePreviewUncertainty(state, ruleset, actorId);
  if (uncertainty.usesRandomness || uncertainty.observesHiddenInformation) return { states: [], indeterminate: true, requiresLifecycle: true };
  const choice = state.effectState.pendingChoice;
  if (!choice || choice.actorId !== actorId) return { states: [], indeterminate: false, requiresLifecycle: true };
  if (depth >= maxCommandPreviewDepth) return { states: [], indeterminate: true, requiresLifecycle: true };
  const completed: GameState[] = [];
  let indeterminate = false;
  for (const option of choice.options) {
    if (budget.remaining <= 0) { indeterminate = true; break; }
    budget.remaining -= 1;
    const branch = structuredClone(state);
    const result = resumeLifecycleChoice(branch, ruleset, actorId, choice.executionId, choice.choiceId, option.id);
    if (branch.rngState !== state.rngState) {
      indeterminate = true;
      continue;
    }
    if (result.status === 'completed') completed.push(branch);
    else if (result.status === 'suspended') {
      if (branch.effectState.pendingCounterConsent) {
        indeterminate = true;
        continue;
      }
      const nested = expandCommandChoicePreviews(branch, ruleset, actorId, depth + 1, budget);
      completed.push(...nested.states); indeterminate ||= nested.indeterminate;
    }
  }
  return { states: completed, indeterminate, requiresLifecycle: true };
}

function resumeCommandChoicePreview(state: GameState, ruleset: Ruleset, actorId: string, optionId: string): CommandBeforePreviewResult {
  const uncertainty = inspectPendingLifecyclePreviewUncertainty(state, ruleset, actorId);
  if (uncertainty.usesRandomness || uncertainty.observesHiddenInformation) return { states: [], indeterminate: true, requiresLifecycle: true };
  const choice = state.effectState.pendingChoice;
  if (!choice || choice.actorId !== actorId) return { states: [], indeterminate: false, requiresLifecycle: true };
  const branch = structuredClone(state);
  const result = resumeLifecycleChoice(branch, ruleset, actorId, choice.executionId, choice.choiceId, optionId);
  if (branch.rngState !== state.rngState) return { states: [], indeterminate: true, requiresLifecycle: true };
  if (result.status === 'completed') return { states: [branch], indeterminate: false, requiresLifecycle: true };
  if (result.status === 'suspended' && branch.effectState.pendingCounterConsent) return { states: [], indeterminate: true, requiresLifecycle: true };
  return result.status === 'suspended' ? expandCommandChoicePreviews(branch, ruleset, actorId, 1, { remaining: maxCommandPreviewBranches }) : { states: [], indeterminate: false, requiresLifecycle: true };
}

function previewCommandBefore(state: GameState, ruleset: Ruleset, actorId: string, commandType: 'ATTACK_TARGET' | 'BUY_CARD'): CommandBeforePreviewResult {
  const payload = { schemaVersion: 1 as const, point: 'command-before' as const, actorId, commandType, phase: state.phase, metadata: { commandId: `legal-preview-${state.revision + 1}` } };
  const uncertainty = inspectLifecyclePreviewUncertainty(state, ruleset, payload, { controllerId: actorId }, actorId);
  if (uncertainty.usesRandomness || uncertainty.observesHiddenInformation) return { states: [], indeterminate: true, requiresLifecycle: true };
  const preview = structuredClone(state);
  const result = dispatchLifecycle(preview, ruleset, payload, { controllerId: actorId });
  if (preview.rngState !== state.rngState) return { states: [], indeterminate: true, requiresLifecycle: true };
  if (result.status === 'completed') return { states: [preview], indeterminate: false, requiresLifecycle: false };
  if (result.status === 'suspended' && preview.effectState.pendingCounterConsent) return { states: [], indeterminate: true, requiresLifecycle: true };
  return result.status === 'suspended' ? expandCommandChoicePreviews(preview, ruleset, actorId, 0, { remaining: maxCommandPreviewBranches }) : { states: [], indeterminate: false, requiresLifecycle: false };
}

function attackIsLegalInAnyPreview(preview: CommandBeforePreviewResult, ruleset: Ruleset, actorId: string, targetId: string): boolean {
  if (preview.indeterminate) return true;
  if (preview.states.some((state) => inspectContinuousPreviewUncertainty(state, ruleset, actorId).observesHiddenInformation)) return true;
  return preview.states.some((state) => {
    const target = state.enemyTargets[targetId];
    if (!target || target.status !== 'available') return false;
    if (target.health) {
      const result = evaluateAttackResolution(state, ruleset, { schemaVersion: 1, playerId: actorId, targetId, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } });
      return result.status === 'ready' || failedHealthAttackMayDependOnHiddenEncounter(state, ruleset, actorId, targetId, result);
    }
    const result = evaluateCombat(state, ruleset, actorId, targetId);
    if (result.status !== 'ready' || !result.evaluation.eligible) return false;
    if (target.kind === 'monster' && evaluateMonsterDefeatContinuity(state, ruleset, targetId, result.evaluation.outcome.kind).status !== 'ready') return false;
    return getCombatPrefix(state, ruleset, actorId, result.evaluation.requiredCombat) !== undefined;
  });
}

function purchaseIsLegalInAnyPreview(preview: CommandBeforePreviewResult, ruleset: Ruleset, actorId: string, cardId: string): boolean {
  if (preview.indeterminate) return true;
  return preview.states.some((state) => {
    const isPublicSupply = state.zones[baseZoneIds.adventurerRow]?.cardIds.includes(cardId) || state.zones[baseZoneIds.itemRow]?.cardIds.includes(cardId);
    return Boolean(isPublicSupply) && (getDefinition(ruleset.registry, state, cardId).cost ?? Number.POSITIVE_INFINITY) <= getPurchasePower(state, ruleset, actorId);
  });
}

export function getPurchasePower(state: GameState, ruleset: Ruleset, playerId: string): number {
  const player = getPlayer(state, playerId);
  const handPower = player.hand.reduce((sum, cardId) => sum + (getDefinition(ruleset.registry, state, cardId).purchasePower ?? 0), 0);
  return handPower + player.turnPurchaseBonus - player.turnPurchaseSpent;
}

export function getCombatPrefix(state: GameState, ruleset: Ruleset, playerId: string, required: number): { slotCount: number; power: number } | undefined {
  const prefix = evaluateCombatPartyPrefix(state, ruleset, playerId, required);
  return prefix ? { slotCount: prefix.slotCount, power: prefix.power } : undefined;
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
    const pendingCommand = state.effectState.pendingCommand?.envelope.command;
    const options = pendingCommand?.type === 'ATTACK_TARGET' && state.effectState.pendingCommand?.kind !== 'combat-reward'
      ? pending.options.filter((option) => attackIsLegalInAnyPreview(resumeCommandChoicePreview(state, ruleset, actorId, option.id), ruleset, actorId, pendingCommand.targetId))
      : pendingCommand?.type === 'BUY_CARD'
        ? pending.options.filter((option) => purchaseIsLegalInAnyPreview(resumeCommandChoicePreview(state, ruleset, actorId, option.id), ruleset, actorId, pendingCommand.cardId))
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
    const preview = previewCommandBefore(state, ruleset, actorId, 'ATTACK_TARGET');
    for (const target of Object.values(state.enemyTargets)) {
      if (target.status !== 'available') continue;
      if (!target.health && target.kind === 'monster' && evaluateMonsterDefeatContinuity(state, ruleset, target.targetId).status !== 'ready') continue;
      if (attackIsLegalInAnyPreview(preview, ruleset, actorId, target.targetId)) commands.push({ type: 'ATTACK_TARGET', targetId: target.targetId });
    }
  }
  if (state.phase === 'purchase') {
    const preview = previewCommandBefore(state, ruleset, actorId, 'BUY_CARD');
    for (const cardId of [...state.zones[baseZoneIds.adventurerRow]!.cardIds, ...state.zones[baseZoneIds.itemRow]!.cardIds]) {
      if (purchaseIsLegalInAnyPreview(preview, ruleset, actorId, cardId)) commands.push({ type: 'BUY_CARD', cardId });
    }
  }
  commands.push({ type: 'END_PHASE', phase: state.phase });
  return commands;
}

function readyAttackPreview(state: GameState, ruleset: Ruleset, actorId: string, command: Extract<GameCommand, { type: 'ATTACK_TARGET' }>): Extract<ActionPreviewItem, { kind: 'attack'; status: 'ready' }> | undefined {
  const target = state.enemyTargets[command.targetId];
  if (!target || target.status !== 'available') return undefined;
  if (attackPreviewObservesHiddenInformation(state, ruleset, actorId, command.targetId)) return undefined;
  if (target.health) {
    const result = evaluateAttackResolution(state, ruleset, {
      schemaVersion: 1,
      playerId: actorId,
      targetId: command.targetId,
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
    });
    if (result.status !== 'ready') return undefined;
    const { combat, partyPrefix, damage } = result.evaluation;
    const lethalOutcome = damage.input.lethalOutcome;
    if (!lethalOutcome) return undefined;
    return {
      kind: 'attack',
      status: 'ready',
      command: structuredClone(command),
      targetId: command.targetId,
      requiredCombat: combat.requiredCombat,
      committedCombat: partyPrefix.power,
      surplusCombat: partyPrefix.power - combat.requiredCombat,
      partySlotCount: partyPrefix.slotCount,
      participantCardIds: [...partyPrefix.participantCardIds],
      outcome: {
        kind: 'damage-target',
        requestedDamage: damage.input.requestedDamage,
        actualDamage: damage.actualDamage,
        healthBefore: damage.input.healthBefore.current,
        healthAfter: damage.healthAfter.current,
        lethal: damage.lethal,
        lethalOutcome,
      },
    };
  }
  const combat = evaluateCombat(state, ruleset, actorId, command.targetId);
  if (combat.status !== 'ready' || !combat.evaluation.eligible) return undefined;
  const partyPrefix = evaluateCombatPartyPrefix(state, ruleset, actorId, combat.evaluation.requiredCombat);
  if (!partyPrefix) return undefined;
  return {
    kind: 'attack',
    status: 'ready',
    command: structuredClone(command),
    targetId: command.targetId,
    requiredCombat: combat.evaluation.requiredCombat,
    committedCombat: partyPrefix.power,
    surplusCombat: partyPrefix.power - combat.evaluation.requiredCombat,
    partySlotCount: partyPrefix.slotCount,
    participantCardIds: [...partyPrefix.participantCardIds],
    outcome: { kind: combat.evaluation.outcome.kind },
  };
}

function attackPreviewItem(preview: CommandBeforePreviewResult, ruleset: Ruleset, actorId: string, command: Extract<GameCommand, { type: 'ATTACK_TARGET' }>): Extract<ActionPreviewItem, { kind: 'attack' }> {
  if (!preview.requiresLifecycle && !preview.indeterminate && preview.states.length > 0) {
    const ready = preview.states.map((state) => readyAttackPreview(state, ruleset, actorId, command));
    const first = ready[0];
    if (first && ready.every((item) => item !== undefined && JSON.stringify(item) === JSON.stringify(first))) return first;
  }
  return { kind: 'attack', status: 'requires-lifecycle', command: structuredClone(command), targetId: command.targetId };
}

function purchasePreviewItem(preview: CommandBeforePreviewResult, ruleset: Ruleset, actorId: string, command: Extract<GameCommand, { type: 'BUY_CARD' }>): Extract<ActionPreviewItem, { kind: 'purchase' }> {
  if (!preview.requiresLifecycle && !preview.indeterminate && preview.states.length === 1) {
    const previewState = preview.states[0]!;
    const cost = getDefinition(ruleset.registry, previewState, command.cardId).cost;
    const availablePurchasePower = getPurchasePower(previewState, ruleset, actorId);
    if (cost !== undefined && cost <= availablePurchasePower) return {
      kind: 'purchase',
      status: 'ready',
      command: structuredClone(command),
      cardId: command.cardId,
      cost,
      availablePurchasePower,
      remainingPurchasePower: availablePurchasePower - cost,
    };
  }
  return { kind: 'purchase', status: 'requires-lifecycle', command: structuredClone(command), cardId: command.cardId };
}

/** Pure deterministic, versioned action previews for the exact authoritative legal-command set. */
export function getActionPreviewSet(state: GameState, ruleset: Ruleset, actorId: string): ActionPreviewSet {
  const legalCommands = getLegalCommands(state, ruleset, actorId);
  const items: ActionPreviewItem[] = [];
  const attackCommands = legalCommands.filter((command): command is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => command.type === 'ATTACK_TARGET');
  if (attackCommands.length > 0) {
    const preview = previewCommandBefore(state, ruleset, actorId, 'ATTACK_TARGET');
    items.push(...attackCommands.map((command) => attackPreviewItem(preview, ruleset, actorId, command)));
  }
  const purchaseCommands = legalCommands.filter((command): command is Extract<GameCommand, { type: 'BUY_CARD' }> => command.type === 'BUY_CARD');
  if (purchaseCommands.length > 0) {
    const preview = previewCommandBefore(state, ruleset, actorId, 'BUY_CARD');
    items.push(...purchaseCommands.map((command) => purchasePreviewItem(preview, ruleset, actorId, command)));
  }
  return ActionPreviewSetSchema.parse({ schemaVersion: 1, gameId: state.gameId, revision: state.revision, actorId, items });
}

export function envelope(state: GameState, actorId: string, command: GameCommand, commandId = `legal-${state.revision + 1}`): CommandEnvelope {
  return { protocolVersion: 1, gameId: state.gameId, commandId, actorId, expectedRevision: state.revision, command };
}
