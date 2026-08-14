import { baseRulesModule, type RulesModule } from '@guildmaster/game-engine';
import type { CombatRewardPolicy, EffectDefinition, EquipmentCombatModifierRule } from '@guildmaster/game-protocol';

export const baseProvisionalOriginalFullRulesModuleId = 'base:provisional-original-full-rules';

const reward = (
  rewardPolicyId: string,
  definitionId: string,
  priority: number,
  body: EffectDefinition['body'],
): CombatRewardPolicy => ({
  schemaVersion: 1,
  rewardPolicyId,
  moduleId: baseProvisionalOriginalFullRulesModuleId,
  priority,
  condition: { kind: 'target-definition-id-in', definitionIds: [definitionId] },
  recipient: 'defeating-player',
  reward: {
    schemaVersion: 1,
    effectId: `${baseProvisionalOriginalFullRulesModuleId}/${rewardPolicyId}`,
    body,
  },
});

const professionEquipmentBonus = (
  ruleId: string,
  equipmentDefinitionId: string,
  professionTag: string,
  priority: number,
): EquipmentCombatModifierRule => ({
  schemaVersion: 1,
  ruleId,
  moduleId: baseProvisionalOriginalFullRulesModuleId,
  priority,
  when: {
    kind: 'all',
    conditions: [
      { kind: 'equipment-definition-in', definitionIds: [equipmentDefinitionId] },
      { kind: 'adventurer-tag-in', tags: [professionTag] },
    ],
  },
  kind: 'combat-power-modifier',
  amount: 1,
});

const optionalRemoval = (
  choiceId: string,
  locations: readonly ({ kind: 'player-zone'; player: { kind: 'controller' }; zone: 'hand' | 'discardPile' } | { kind: 'party'; player: { kind: 'controller' } })[],
): EffectDefinition['body'] => ({
  kind: 'choose-card',
  choiceId,
  decisionKind: 'remove-card',
  actor: { kind: 'controller' },
  from: locations.length === 1 ? locations[0]! : { kind: 'one-of', locations },
  selectedCardKey: 'removed',
  selectedLocationKey: 'removedFrom',
  skipOptionId: `${choiceId}:skip`,
  effect: {
    kind: 'remove-from-game',
    card: { kind: 'context-card', key: 'removed' },
    from: { kind: 'context-location', key: 'removedFrom' },
    attachedEquipmentDisposition: 'discard',
  },
});

const optionalReward = (choiceId: string, effect: EffectDefinition['body']): EffectDefinition['body'] => ({
  kind: 'choice',
  choiceId,
  decisionKind: 'choose-effect-option',
  actor: { kind: 'controller' },
  options: [
    { id: `${choiceId}:activate`, effect },
    { id: `${choiceId}:skip`, effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 } },
  ],
});

const hand = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } as const;
const discardPile = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const;
const party = { kind: 'party', player: { kind: 'controller' } } as const;

/**
 * Data-driven rules for the small, visually unambiguous first effect batch.
 * Card IDs live here instead of in game-engine so the generic engine remains
 * unaware of provisional content identities.
 */
export const baseProvisionalOriginalFullRulesModule: RulesModule = {
  id: baseProvisionalOriginalFullRulesModuleId,
  version: '1.4.0',
  config: {
    effectBatch: 'card-rules-a',
    enabledDefinitionIds: [
      'base:adventurer/adventurer-02',
      'base:adventurer/adventurer-09',
      'base:resource/resource-02',
      'base:resource/resource-03',
      'base:resource/resource-07',
      'base:resource/resource-25',
      'base:monster/monster-01',
      'base:monster/monster-02',
      'base:monster/monster-03',
      'base:monster/monster-06',
      'base:monster/monster-09',
      'base:monster/monster-10',
      'base:monster/monster-11',
      'base:monster/monster-14',
    ],
  },
  composition: {
    schemaVersion: 1,
    kind: 'optional',
    priority: 20,
    dependencies: [{ moduleId: baseRulesModule.id, version: baseRulesModule.version }],
  },
  equipmentEligibilityRules: [{
    schemaVersion: 1,
    ruleId: 'adventurer-02-no-equipment',
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    priority: 10,
    when: { kind: 'adventurer-definition-in', definitionIds: ['base:adventurer/adventurer-02'] },
    kind: 'restriction',
    reasonCode: 'ADVENTURER_CANNOT_EQUIP',
  }],
  equipmentCombatModifierRules: [
    {
      schemaVersion: 1,
      ruleId: 'adventurer-09-equipped-bonus',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 10,
      when: { kind: 'adventurer-definition-in', definitionIds: ['base:adventurer/adventurer-09'] },
      kind: 'combat-power-modifier',
      amount: 1,
    },
    professionEquipmentBonus('resource-02-melee-bonus', 'base:resource/resource-02', 'profession:melee', 20),
    professionEquipmentBonus('resource-03-support-bonus', 'base:resource/resource-03', 'profession:support', 30),
    professionEquipmentBonus('resource-07-ranged-bonus', 'base:resource/resource-07', 'profession:ranged', 40),
    professionEquipmentBonus('resource-25-tank-bonus', 'base:resource/resource-25', 'profession:tank', 50),
  ],
  diceDefinitions: [{
    schemaVersion: 1,
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    diceId: 'monster-02-reward-d6',
    sides: 6,
  }],
  combatRewardPolicies: [
    reward(
      'monster-01-purchase-bonus',
      'base:monster/monster-01',
      10,
      optionalReward('base:monster/monster-01-reward', {
        kind: 'modify-value',
        target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } },
        amount: 1,
      }),
    ),
    reward(
      'monster-02-roll-purchase-bonus',
      'base:monster/monster-02',
      20,
      optionalReward('base:monster/monster-02-reward', {
        kind: 'roll-die',
        moduleId: baseProvisionalOriginalFullRulesModuleId,
        diceId: 'monster-02-reward-d6',
        outcomes: Array.from({ length: 6 }, (_, index) => ({
          face: index + 1,
          effect: {
            kind: 'modify-value' as const,
            target: { kind: 'turn-purchase-bonus' as const, player: { kind: 'controller' as const } },
            amount: Math.ceil((index + 1) / 2),
          },
        })),
      }),
    ),
    reward(
      'monster-03-remove-one',
      'base:monster/monster-03',
      25,
      optionalRemoval('base:monster/monster-03-remove-one', [hand, party, discardPile]),
    ),
    reward(
      'monster-06-remove-up-to-two',
      'base:monster/monster-06',
      28,
      {
        kind: 'sequence',
        effects: [
          optionalRemoval('base:monster/monster-06-remove-first', [hand, party, discardPile]),
          optionalRemoval('base:monster/monster-06-remove-second', [hand, party, discardPile]),
        ],
      },
    ),
    reward(
      'monster-09-draw-two',
      'base:monster/monster-09',
      30,
      optionalReward('base:monster/monster-09-reward', { kind: 'draw', player: { kind: 'controller' }, count: 2 }),
    ),
    reward(
      'monster-10-remove-hand',
      'base:monster/monster-10',
      35,
      optionalRemoval('base:monster/monster-10-remove-hand', [hand]),
    ),
    reward(
      'monster-11-remove-discard',
      'base:monster/monster-11',
      38,
      optionalRemoval('base:monster/monster-11-remove-discard', [discardPile]),
    ),
    reward(
      'monster-14-draw-one',
      'base:monster/monster-14',
      40,
      optionalReward('base:monster/monster-14-reward', { kind: 'draw', player: { kind: 'controller' }, count: 1 }),
    ),
  ],
  getPartyLimit: (_state, _player, currentLimit) => currentLimit,
  onSupplyDepleted: () => 'handled',
};
