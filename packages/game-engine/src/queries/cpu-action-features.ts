import type { CpuActionFeature, GameCommand, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { getLegalCommands } from './legal-commands.js';
import type { Ruleset } from '../rules/ruleset.js';

function blank(command: GameCommand): CpuActionFeature {
  return { schemaVersion: 1, command: structuredClone(command), honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, overflowLoss: 0 };
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
      }
    }
    if (command.type === 'PLAY_ADVENTURER') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.partyCombatGain = definition.combat ?? 0;
      feature.honorGain = definition.honor ?? 0;
    }
    if (command.type === 'EQUIP_ITEM') feature.partyCombatGain = getDefinition(ruleset.registry, state, command.cardId).combat ?? 0;
    if (command.type === 'USE_ITEM') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.immediateCombatPower = definition.itemEffect === 'combat+2' ? 2 : 0;
      feature.immediatePurchasePower = definition.itemEffect === 'purchase+2' ? 2 : 0;
    }
    if (command.type === 'BUY_CARD') {
      const definition = getDefinition(ruleset.registry, state, command.cardId);
      feature.honorGain = definition.honor ?? 0;
      feature.permanentPurchasePower = definition.purchasePower ?? 0;
      feature.partyCombatGain = definition.combat ?? 0;
      feature.purchaseCost = definition.cost ?? 0;
    }
    return feature;
  });
}
