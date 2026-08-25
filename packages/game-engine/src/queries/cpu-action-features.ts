import type { CpuActionFeature, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { getLegalCommands } from './legal-commands.js';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';
import { evaluateCombat, evaluateCombatPartyCapacity, evaluateCombatPartyPrefix } from '../rules/combat-evaluator.js';
import { evaluatePartyCombat } from '../rules/party-combat-modifier-evaluator.js';
import { evaluatePurchaseCost } from '../rules/purchase-cost-evaluator.js';
import { evaluateEquipmentDeparture } from '../rules/equipment-departure-evaluator.js';
import { evaluateCombatRewards } from '../rules/combat-reward-evaluator.js';
import { effectStartsWithUnpayableCombatFailureGate } from '../effects/executor.js';
import { attachedCardIds, setAttachedCardIds } from '../model/attachments.js';
import { attachmentCombat } from '../rules/attachment-evaluator.js';
import { evaluateEquipmentCombatModifiers } from '../rules/equipment-combat-modifier-evaluator.js';
import { evaluateAttackResolution } from '../rules/attack-resolution-evaluator.js';
import { evaluateMonsterDefeatContinuity } from '../rules/supply-continuity-evaluator.js';
import { dispatch } from '../engine/dispatch.js';
import { evaluateCombatAssist } from '../rules/combat-assist-evaluator.js';
import { evaluateCombatParticipantDeparture } from '../rules/combat-participant-departure-evaluator.js';
import { evaluateCombatDepartureReplacements, legalCombatDepartureReplacementSelections } from '../rules/combat-departure-replacement-evaluator.js';

function attachedContribution(state: GameState, ruleset: Ruleset, playerId: string, adventurerId: string, cardId: string): number {
  const base = attachmentCombat(state, ruleset, playerId, adventurerId, cardId);
  if (getDefinition(ruleset.registry, state, cardId).type !== 'equipment') return base;
  const modifiers = evaluateEquipmentCombatModifiers(state, ruleset, { schemaVersion: 1, playerId, equipmentCardId: cardId, adventurerId });
  if (modifiers.status !== 'ready') throw new Error(`CPU action features require valid equipment combat modifiers: ${modifiers.error}`);
  return base + modifiers.evaluation.powerBonus;
}

function targetCombatProgress(state: GameState, ruleset: Ruleset, playerId: string) {
  const combatState = state.phase === 'combat' ? state : { ...structuredClone(state), phase: 'combat' as const };
  return Object.values(combatState.enemyTargets).filter(({ status }) => status === 'available').sort((left, right) => left.targetId.localeCompare(right.targetId)).map((target) => {
    const combat = evaluateCombat(combatState, ruleset, playerId, target.targetId);
    if (combat.status !== 'ready') throw new Error(`CPU action features require valid target combat evaluation: ${combat.reason}: ${combat.error}`);
    const capacity = evaluateCombatPartyCapacity(combatState, ruleset, playerId, target.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed);
    if (capacity === undefined) throw new Error(`CPU action features require valid target combat capacity for ${target.targetId}.`);
    const healthAttack = target.health ? evaluateAttackResolution(combatState, ruleset, { schemaVersion: 1, playerId, targetId: target.targetId, registry: { rulesetVersion: combatState.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }) : undefined;
    const continuityReady = target.kind !== 'monster' || evaluateMonsterDefeatContinuity(combatState, ruleset, target.targetId, combat.evaluation.outcome.kind).status === 'ready';
    const attackReady = healthAttack ? healthAttack.status === 'ready' : combat.evaluation.eligible && capacity >= combat.evaluation.requiredCombat && continuityReady;
    return { targetId: target.targetId, targetKind: target.kind, requiredCombat: combat.evaluation.requiredCombat, effectiveCombat: capacity, shortfall: Math.max(0, combat.evaluation.requiredCombat - capacity), attackReady };
  });
}

function blank(command: GameCommand, targets: ReturnType<typeof targetCombatProgress>): CpuActionFeature {
  return { schemaVersion: 2, command: structuredClone(command), honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, equipmentRemoval: 0, overflowLoss: 0, targetCombatProgress: targets.map((target) => ({ targetId: target.targetId, targetKind: target.targetKind, requiredCombat: target.requiredCombat, effectiveCombatBefore: target.effectiveCombat, effectiveCombatAfter: target.effectiveCombat, shortfallBefore: target.shortfall, shortfallAfter: target.shortfall, attackReadyBefore: target.attackReady, attackReadyAfter: target.attackReady })) };
}

function applyTargetCombatAfter(feature: CpuActionFeature, state: GameState, ruleset: Ruleset, actorId: string): void {
  const after = new Map(targetCombatProgress(state, ruleset, actorId).map((target) => [target.targetId, target]));
  feature.targetCombatProgress = feature.targetCombatProgress.map((target) => {
    const next = after.get(target.targetId);
    return next ? { ...target, effectiveCombatAfter: next.effectiveCombat, shortfallAfter: next.shortfall, attackReadyAfter: next.attackReady } : target;
  });
}

function applyDispatchedTargetCombatAfter(feature: CpuActionFeature, state: GameState, ruleset: Ruleset, actorId: string, command: GameCommand): void {
  const result = dispatch(state, ruleset, { protocolVersion: 1, gameId: state.gameId, commandId: `cpu-feature-preview-${state.revision}`, actorId, expectedRevision: state.revision, command: structuredClone(command) });
  if (result.error || result.state.rngState !== state.rngState || result.state.effectState.pendingChoice || result.state.effectState.pendingCounterConsent || result.state.effectState.pendingCommand || result.state.effectState.pendingLifecycle || result.state.effectState.pendingPostCommand) return;
  applyTargetCombatAfter(feature, result.state, ruleset, actorId);
}

function partyCombatTotal(state: GameState, ruleset: Ruleset, playerId: string, targetId?: string, equipmentSuppressed = false): number {
  const evaluation = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId, ...(targetId ? { targetId } : {}), ...(equipmentSuppressed ? { equipmentSuppressed: true } : {}) });
  if (evaluation.status !== 'ready') throw new Error(`CPU action features require valid party combat modifiers: ${evaluation.reason}: ${evaluation.error}`);
  return evaluation.evaluation.members.reduce((sum, member) => sum + member.effectiveCombat, 0);
}

function partyCombatAfterRemoving(state: GameState, ruleset: Ruleset, playerId: string, removedIds: readonly string[], targetId?: string, equipmentSuppressed = false): number {
  const preview = structuredClone(state);
  const player = preview.players.find(({ id }) => id === playerId);
  if (!player) throw new Error(`CPU action features require an existing player ${playerId}.`);
  const removed = new Set(removedIds);
  player.party = player.party.filter(({ adventurerId }) => !removed.has(adventurerId));
  return partyCombatTotal(preview, ruleset, playerId, targetId, equipmentSuppressed);
}

function candidateSets(values: readonly string[], count: number, limit = 257): string[][] {
  const results: string[][] = [];
  const visit = (start: number, prefix: string[]): void => {
    if (results.length >= limit) return;
    if (prefix.length === count) { results.push(prefix); return; }
    for (let index = start; index < values.length && results.length < limit; index += 1) visit(index + 1, [...prefix, values[index]!]);
  };
  visit(0, []);
  return results;
}

/** Public, deterministic features for a legal command; this query never mutates state or advances RNG. */
export function getCpuActionFeatures(state: GameState, ruleset: Ruleset, actorId: string): CpuActionFeature[] {
  const targets = targetCombatProgress(state, ruleset, actorId);
  return getLegalCommands(state, ruleset, actorId).map((command) => {
    const feature = blank(command, targets);
    if (command.type === 'ATTACK_TARGET') {
      const target = state.enemyTargets[command.targetId];
      if (target) {
        const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
        feature.honorGain = definition.honor ?? 0;
        feature.immediatePurchasePower = definition.purchasePower ?? 0;
        feature.bossProgress = target.kind === 'boss' ? 1 : 0;
        feature.monsterDefeat = target.kind === 'monster' ? 1 : 0;
        const assist = command.combatAssistCardId ? evaluateCombatAssist(state, ruleset, actorId, command.targetId, command.combatAssistCardId) : undefined;
        if (command.combatAssistCardId && !assist) throw new Error(`CPU action features require a valid combat assist for ${command.targetId}.`);
        const combat = assist ? { status: 'ready' as const, evaluation: assist.combat } : evaluateCombat(state, ruleset, actorId, command.targetId);
        if (combat.status !== 'ready') throw new Error(`CPU action features require valid combat evaluation: ${combat.error}`);
        const prefix = assist?.partyPrefix ?? evaluateCombatPartyPrefix(state, ruleset, actorId, combat.evaluation.requiredCombat, command.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed);
        if (!prefix) throw new Error(`CPU action features require a legal combat party prefix for ${command.targetId}.`);
        const player = state.players.find(({ id }) => id === actorId)!;
        const consumed = player.party.slice(0, prefix.slotCount);
        const assistSlot = assist ? player.party.find(({ adventurerId }) => adventurerId === assist.sourceCardId) : undefined;
        const participantDeparture = evaluateCombatParticipantDeparture(state, ruleset, { schemaVersion: 1, playerId: actorId, targetId: command.targetId, participantCardIds: consumed.map(({ adventurerId }) => adventurerId) });
        if (participantDeparture.status !== 'ready') throw new Error(`CPU action features require valid participant departure: ${participantDeparture.error}`);
        const replacements = evaluateCombatDepartureReplacements(state, ruleset, actorId, participantDeparture.evaluation);
        if (replacements.status !== 'ready') throw new Error(`CPU action features require valid departure replacements: ${replacements.error}`);
        const selectedReplacementIds = new Set(legalCombatDepartureReplacementSelections(state, actorId, replacements.candidates).at(-1) ?? []);
        const replacementFor = (adventurerId: string) => replacements.candidates.find((candidate) => selectedReplacementIds.has(candidate.candidateId) && candidate.adventurerId === adventurerId);
        const kept = new Set(consumed.filter(({ adventurerId }) => {
          const replacement = replacementFor(adventurerId)?.replacement.kind;
          return replacement === 'keep-self-in-party' || replacement === 'discard-attached-card';
        }).map(({ adventurerId }) => adventurerId));
        const departingParticipants = consumed.filter(({ adventurerId }) => !kept.has(adventurerId));
        const departing = assistSlot ? [...departingParticipants, assistSlot] : departingParticipants;
        feature.partyCombatLoss = partyCombatTotal(state, ruleset, actorId, command.targetId, combat.evaluation.equipmentSuppressed)
          - partyCombatAfterRemoving(state, ruleset, actorId, departing.map(({ adventurerId }) => adventurerId), command.targetId, combat.evaluation.equipmentSuppressed);
        const replacementAttachmentIds = consumed.flatMap(({ adventurerId }) => {
          const replacement = replacementFor(adventurerId);
          return replacement?.replacement.kind === 'discard-attached-card' && replacement.attachmentCardId ? [replacement.attachmentCardId] : [];
        });
        feature.equipmentLoss = departing.flatMap(attachedCardIds).length + replacementAttachmentIds.length;
        feature.equipmentRemoval = departingParticipants.reduce((count, slot) => {
          if (combat.evaluation.equipmentSuppressed) return count;
          return count + attachedCardIds(slot).filter((equipmentCardId) => {
            const departure = evaluateEquipmentDeparture(state, ruleset, { schemaVersion: 1, playerId: actorId, adventurerId: slot.adventurerId, equipmentCardId, cause: 'combat-discard' });
            if (departure.status !== 'ready') throw new Error(`CPU action features require valid equipment departure policies: ${departure.reason}: ${departure.error}`);
            return departure.evaluation.disposition === 'remove-from-game';
          }).length;
        }, 0);
        const rewards = evaluateCombatRewards(state, ruleset, actorId, command.targetId);
        if (rewards.status !== 'ready') throw new Error(`CPU action features require valid combat rewards: ${rewards.error}`);
        const willFailCombat = rewards.evaluation.matchedPolicies.some((reference) => {
          const policy = ruleset.modules.find(({ id }) => id === reference.moduleId)?.combatRewardPolicies?.find(({ rewardPolicyId }) => rewardPolicyId === reference.rewardPolicyId);
          return Boolean(policy && effectStartsWithUnpayableCombatFailureGate(state, ruleset, policy.reward, { controllerId: actorId }));
        });
        if (willFailCombat) {
          feature.honorGain = 0;
          feature.immediatePurchasePower = 0;
          feature.bossProgress = 0;
          feature.monsterDefeat = 0;
        }
      }
    }
    if (command.type === 'PLAY_ADVENTURER') {
      const overflow = evaluateTeamOverflow(state, ruleset, { schemaVersion: 1, playerId: actorId, incomingMemberId: command.cardId });
      if (overflow.status !== 'ready') throw new Error(`CPU action features require a valid team overflow policy: ${overflow.error}`);
      const preview = structuredClone(state);
      const previewPlayer = preview.players.find(({ id }) => id === actorId);
      if (!previewPlayer) throw new Error(`CPU action features require an existing player ${actorId}.`);
      const beforeCombat = partyCombatTotal(state, ruleset, actorId);
      previewPlayer.party.push({ adventurerId: command.cardId });
      const combatWithIncoming = partyCombatTotal(preview, ruleset, actorId);
      feature.partyCombatGain = combatWithIncoming - beforeCombat;
      if (overflow.evaluation.status === 'overflow-required') {
        const choices = overflow.evaluation.policy?.mode === 'player-choice'
          ? candidateSets(overflow.evaluation.candidateIds, overflow.evaluation.overflowCount)
          : [overflow.evaluation.candidateIds];
        if (choices.length > 256) throw new Error('CPU action features do not support team overflow choices above the authoritative 256-option budget.');
        const outcomes = choices.map((removedIds) => {
          const afterCombat = partyCombatAfterRemoving(preview, ruleset, actorId, removedIds);
          const equipmentLoss = removedIds.reduce((count, cardId) => count + attachedCardIds(previewPlayer.party.find(({ adventurerId }) => adventurerId === cardId)!).length, 0);
          return { removedIds, partyCombatLoss: combatWithIncoming - afterCombat, equipmentLoss };
        }).sort((left, right) => left.partyCombatLoss - right.partyCombatLoss || left.equipmentLoss - right.equipmentLoss || JSON.stringify(left.removedIds).localeCompare(JSON.stringify(right.removedIds)));
        const selected = outcomes[0];
        if (!selected) throw new Error('CPU action features require at least one valid team overflow outcome.');
        feature.partyCombatLoss = selected.partyCombatLoss;
        feature.equipmentLoss = selected.equipmentLoss;
        feature.overflowLoss = selected.removedIds.length;
        const removed = new Set(selected.removedIds);
        previewPlayer.party = previewPlayer.party.filter(({ adventurerId }) => !removed.has(adventurerId));
      }
      applyDispatchedTargetCombatAfter(feature, state, ruleset, actorId, command);
    }
    if (command.type === 'EQUIP_ITEM' || command.type === 'ATTACH_CARD') {
      const previewState = structuredClone(state);
      const previewSlot = previewState.players.find(({ id }) => id === actorId)?.party.find(({ adventurerId }) => adventurerId === command.adventurerId);
      if (!previewSlot) throw new Error(`CPU action features require an existing equipment target ${command.adventurerId}.`);
      const beforeCombat = partyCombatTotal(state, ruleset, actorId);
      const current = attachedCardIds(previewSlot);
      const replacedCardId = command.type === 'EQUIP_ITEM' ? current[0] : command.replaceCardId;
      if (replacedCardId) feature.partyCombatLoss = attachedContribution(state, ruleset, actorId, command.adventurerId, replacedCardId);
      if (command.type === 'EQUIP_ITEM' && current[0]) {
        feature.equipmentLoss = 1;
        setAttachedCardIds(previewSlot, [command.cardId]);
      } else if (command.type === 'ATTACH_CARD' && command.replaceCardId) {
        feature.equipmentLoss = 1;
        setAttachedCardIds(previewSlot, current.map((id) => id === command.replaceCardId ? command.cardId : id));
      } else {
        setAttachedCardIds(previewSlot, [...current, command.cardId]);
      }
      const afterCombat = partyCombatTotal(previewState, ruleset, actorId);
      feature.partyCombatGain = attachedContribution(previewState, ruleset, actorId, command.adventurerId, command.cardId);
      if (!replacedCardId && afterCombat < beforeCombat) feature.partyCombatLoss += beforeCombat - afterCombat;
      applyTargetCombatAfter(feature, previewState, ruleset, actorId);
    }
    if (command.type === 'USE_ITEM') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.immediateCombatPower = definition.itemEffect === 'combat+2' ? 2 : 0;
      feature.immediatePurchasePower = definition.itemEffect === 'purchase+2' ? 2 : 0;
      if (feature.immediateCombatPower) {
        const preview = structuredClone(state);
        const player = preview.players.find(({ id }) => id === actorId);
        if (!player) throw new Error(`CPU action features require an existing player ${actorId}.`);
        player.turnCombatBonus += feature.immediateCombatPower;
        applyTargetCombatAfter(feature, preview, ruleset, actorId);
      }
    }
    if (command.type === 'BUY_CARD') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      const purchaseCost = evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: actorId, cardId: command.cardId });
      if (purchaseCost.status !== 'ready') throw new Error(`CPU action features require a valid purchase cost: ${purchaseCost.error}`);
      feature.honorGain = definition.honor ?? 0;
      feature.permanentPurchasePower = definition.purchasePower ?? 0;
      feature.partyCombatGain = definition.combat ?? 0;
      feature.purchaseCost = purchaseCost.evaluation.effectiveCost;
    }
    if (command.type === 'COMPLETE_BONDS') {
      feature.bondHonorGain = command.bondIds.reduce((sum, bondId) => sum + (ruleset.registry.bonds.find(({ id }) => id === bondId)?.honor ?? 0), 0);
    }
    if (command.type === 'RESOLVE_EFFECT_CHOICE' || command.type === 'RESOLVE_EFFECT_ORDER') applyDispatchedTargetCombatAfter(feature, state, ruleset, actorId, command);
    return feature;
  });
}
