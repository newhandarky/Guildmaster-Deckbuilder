import type { CpuActionFeature, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { getLegalCommands } from './legal-commands.js';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';
import { evaluateCombat, evaluateCombatPartyPrefix } from '../rules/combat-evaluator.js';
import { evaluateEquipmentCombatModifiers } from '../rules/equipment-combat-modifier-evaluator.js';
import { evaluatePartyCombat } from '../rules/party-combat-modifier-evaluator.js';
import { evaluatePurchaseCost } from '../rules/purchase-cost-evaluator.js';
import { evaluateEquipmentDeparture } from '../rules/equipment-departure-evaluator.js';
import { evaluateCombatRewards } from '../rules/combat-reward-evaluator.js';
import { effectStartsWithUnpayableCombatFailureGate } from '../effects/executor.js';

function blank(command: GameCommand): CpuActionFeature {
  return { schemaVersion: 1, command: structuredClone(command), honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, equipmentRemoval: 0, overflowLoss: 0 };
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

function equipmentCombat(state: GameState, ruleset: Ruleset, playerId: string, adventurerId: string, equipmentId: string): number {
  const modifiers = evaluateEquipmentCombatModifiers(state, ruleset, { schemaVersion: 1, playerId, equipmentCardId: equipmentId, adventurerId });
  if (modifiers.status !== 'ready') throw new Error(`CPU action features require valid equipment combat modifiers: ${modifiers.error}`);
  return (getDefinition(ruleset.registry, state, equipmentId).combat ?? 0) + modifiers.evaluation.powerBonus;
}

/** Public, deterministic features for a legal command; this query never mutates state or advances RNG. */
export function getCpuActionFeatures(state: GameState, ruleset: Ruleset, actorId: string): CpuActionFeature[] {
  return getLegalCommands(state, ruleset, actorId).map((command) => {
    const feature = blank(command);
    if (command.type === 'ATTACK_TARGET') {
      const target = state.enemyTargets[command.targetId];
      if (target) {
        const definition = getDefinition(ruleset.registry, state, target.cardInstanceId);
        feature.honorGain = definition.honor ?? 0;
        feature.immediatePurchasePower = definition.purchasePower ?? 0;
        feature.bossProgress = target.kind === 'boss' ? 1 : 0;
        feature.monsterDefeat = target.kind === 'monster' ? 1 : 0;
        const combat = evaluateCombat(state, ruleset, actorId, command.targetId);
        if (combat.status !== 'ready') throw new Error(`CPU action features require valid combat evaluation: ${combat.error}`);
        const prefix = evaluateCombatPartyPrefix(state, ruleset, actorId, combat.evaluation.requiredCombat, command.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed);
        if (!prefix) throw new Error(`CPU action features require a legal combat party prefix for ${command.targetId}.`);
        const player = state.players.find(({ id }) => id === actorId)!;
        const consumed = player.party.slice(0, prefix.slotCount);
        feature.partyCombatLoss = partyCombatTotal(state, ruleset, actorId, command.targetId, combat.evaluation.equipmentSuppressed)
          - partyCombatAfterRemoving(state, ruleset, actorId, consumed.map(({ adventurerId }) => adventurerId), command.targetId, combat.evaluation.equipmentSuppressed);
        feature.equipmentLoss = consumed.filter(({ equipmentId }) => equipmentId !== undefined).length;
        feature.equipmentRemoval = consumed.reduce((count, slot) => {
          if (!slot.equipmentId) return count;
          if (combat.evaluation.equipmentSuppressed) return count;
          const departure = evaluateEquipmentDeparture(state, ruleset, { schemaVersion: 1, playerId: actorId, adventurerId: slot.adventurerId, equipmentCardId: slot.equipmentId, cause: 'combat-discard' });
          if (departure.status !== 'ready') throw new Error(`CPU action features require valid equipment departure policies: ${departure.reason}: ${departure.error}`);
          return count + (departure.evaluation.disposition === 'remove-from-game' ? 1 : 0);
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
          const equipmentLoss = removedIds.filter((cardId) => previewPlayer.party.find(({ adventurerId }) => adventurerId === cardId)?.equipmentId !== undefined).length;
          return { removedIds, partyCombatLoss: combatWithIncoming - afterCombat, equipmentLoss };
        }).sort((left, right) => left.partyCombatLoss - right.partyCombatLoss || left.equipmentLoss - right.equipmentLoss || JSON.stringify(left.removedIds).localeCompare(JSON.stringify(right.removedIds)));
        const selected = outcomes[0];
        if (!selected) throw new Error('CPU action features require at least one valid team overflow outcome.');
        feature.partyCombatLoss = selected.partyCombatLoss;
        feature.equipmentLoss = selected.equipmentLoss;
        feature.overflowLoss = selected.removedIds.length;
      }
    }
    if (command.type === 'EQUIP_ITEM') {
      const previewState = structuredClone(state);
      const previewSlot = previewState.players.find(({ id }) => id === actorId)?.party.find(({ adventurerId }) => adventurerId === command.adventurerId);
      if (!previewSlot) throw new Error(`CPU action features require an existing equipment target ${command.adventurerId}.`);
      const replacedEquipmentId = previewSlot.equipmentId;
      if (replacedEquipmentId) {
        feature.partyCombatLoss = equipmentCombat(state, ruleset, actorId, command.adventurerId, replacedEquipmentId);
        feature.equipmentLoss = 1;
      }
      previewSlot.equipmentId = command.cardId;
      feature.partyCombatGain = equipmentCombat(previewState, ruleset, actorId, command.adventurerId, command.cardId);
    }
    if (command.type === 'USE_ITEM') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.immediateCombatPower = definition.itemEffect === 'combat+2' ? 2 : 0;
      feature.immediatePurchasePower = definition.itemEffect === 'purchase+2' ? 2 : 0;
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
    return feature;
  });
}
