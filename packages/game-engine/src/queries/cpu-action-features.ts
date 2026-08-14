import type { CpuActionFeature, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { getLegalCommands } from './legal-commands.js';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateTeamOverflow } from '../rules/team-overflow-evaluator.js';
import { evaluateCombat, evaluateCombatPartyPrefix } from '../rules/combat-evaluator.js';
import { evaluateEquipmentCombatModifiers } from '../rules/equipment-combat-modifier-evaluator.js';
import { evaluatePurchaseCost } from '../rules/purchase-cost-evaluator.js';

function blank(command: GameCommand): CpuActionFeature {
  return { schemaVersion: 1, command: structuredClone(command), honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, overflowLoss: 0 };
}

function attachedSlotCombat(state: GameState, ruleset: Ruleset, playerId: string, slot: GameState['players'][number]['party'][number]): number {
  const equipmentPower = slot.equipmentId ? (getDefinition(ruleset.registry, state, slot.equipmentId).combat ?? 0) : 0;
  const modifiers = slot.equipmentId ? evaluateEquipmentCombatModifiers(state, ruleset, { schemaVersion: 1, playerId, equipmentCardId: slot.equipmentId, adventurerId: slot.adventurerId }) : undefined;
  if (modifiers && modifiers.status !== 'ready') throw new Error(`CPU action features require valid equipment combat modifiers: ${modifiers.error}`);
  return (getDefinition(ruleset.registry, state, slot.adventurerId).combat ?? 0) + equipmentPower + (modifiers?.evaluation.powerBonus ?? 0);
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
        const prefix = evaluateCombatPartyPrefix(state, ruleset, actorId, combat.evaluation.requiredCombat);
        if (!prefix) throw new Error(`CPU action features require a legal combat party prefix for ${command.targetId}.`);
        const player = state.players.find(({ id }) => id === actorId)!;
        const consumed = player.party.slice(0, prefix.slotCount);
        feature.partyCombatLoss = consumed.reduce((sum, slot) => sum + attachedSlotCombat(state, ruleset, actorId, slot), 0);
        feature.equipmentLoss = consumed.filter(({ equipmentId }) => equipmentId !== undefined).length;
      }
    }
    if (command.type === 'PLAY_ADVENTURER') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.partyCombatGain = definition.combat ?? 0;
      const overflow = evaluateTeamOverflow(state, ruleset, { schemaVersion: 1, playerId: actorId, incomingMemberId: command.cardId });
      if (overflow.status !== 'ready') throw new Error(`CPU action features require a valid team overflow policy: ${overflow.error}`);
      if (overflow.evaluation.status === 'overflow-required') {
        const player = state.players.find(({ id }) => id === actorId)!;
        const displaced = overflow.evaluation.candidateIds.map((cardId) => player.party.find(({ adventurerId }) => adventurerId === cardId)).filter((slot) => slot !== undefined);
        feature.partyCombatLoss = displaced.reduce((sum, slot) => sum + attachedSlotCombat(state, ruleset, actorId, slot), 0);
        feature.equipmentLoss = displaced.filter(({ equipmentId }) => equipmentId !== undefined).length;
        feature.overflowLoss = displaced.length;
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
