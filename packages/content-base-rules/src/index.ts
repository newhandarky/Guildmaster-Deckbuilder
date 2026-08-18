import { baseRulesModule, type RulesModule } from '@guildmaster/game-engine';
import type { CombatRewardPolicy, EffectDefinition, EquipmentCombatModifierRule, PartyCombatModifierRule } from '@guildmaster/game-protocol';

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

const partyCombatModifier = (
  ruleId: string,
  sourceSuffix: string,
  priority: number,
  subject: PartyCombatModifierRule['subject'],
  amount: PartyCombatModifierRule['amount'],
  when: PartyCombatModifierRule['when'] = { kind: 'always', value: true },
): PartyCombatModifierRule => ({
  schemaVersion: 1,
  ruleId,
  moduleId: baseProvisionalOriginalFullRulesModuleId,
  priority,
  sourceDefinitionIds: [`base:adventurer/${sourceSuffix}`],
  subject,
  when,
  amount,
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

const publicRowCardsReward = (choiceId: string, zoneId: string, maximumCost: number, count: number, definitionTypes?: readonly string[]): EffectDefinition['body'] => {
  const selectedCardKey = `${choiceId}:selected-${count}`;
  const move: EffectDefinition['body'] = {
    kind: 'move-card',
    card: { kind: 'context-card', key: selectedCardKey },
    from: { kind: 'shared-zone', zoneId },
    to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
    transferOwnership: true,
  };
  return {
    kind: 'choose-card',
    choiceId: `${choiceId}:${count}`,
    decisionKind: 'choose-market-card',
    actor: { kind: 'controller' },
    from: { kind: 'shared-zone', zoneId },
    predicate: definitionTypes
      ? { kind: 'all', predicates: [{ kind: 'definition-type-in', values: definitionTypes }, { kind: 'definition-cost-at-most', value: maximumCost }] }
      : { kind: 'definition-cost-at-most', value: maximumCost },
    selectedCardKey,
    zeroCandidateBehavior: 'skip',
    effect: count === 1 ? move : { kind: 'sequence', effects: [move, publicRowCardsReward(choiceId, zoneId, maximumCost, count - 1, definitionTypes)] },
  };
};

const sharedDeckCardsReward = (sourceZoneId: string, count: number): EffectDefinition['body'] => ({
  kind: 'draw-shared-deck',
  sourceZoneId,
  player: { kind: 'controller' },
  destination: 'discardPile',
  count,
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
  version: '2.2.0',
  config: {
    effectBatch: 'card-rules-a',
    enabledDefinitionIds: [
      'base:adventurer/adventurer-02',
      'base:adventurer/adventurer-04',
      'base:adventurer/adventurer-05',
      'base:adventurer/adventurer-09',
      'base:adventurer/adventurer-10',
      'base:adventurer/adventurer-15',
      'base:adventurer/adventurer-20',
      'base:adventurer/adventurer-24',
      'base:adventurer/adventurer-27',
      'base:resource/resource-02',
      'base:resource/resource-03',
      'base:resource/resource-07',
      'base:resource/resource-12',
      'base:resource/resource-25',
      'base:monster/monster-01',
      'base:monster/monster-02',
      'base:monster/monster-03',
      'base:monster/monster-06',
      'base:monster/monster-09',
      'base:monster/monster-10',
      'base:monster/monster-11',
      'base:monster/monster-14',
      'base:boss/boss-01',
      'base:boss/boss-02',
      'base:boss/boss-03',
      'base:boss/boss-05',
      'base:boss/boss-06',
      'base:boss/boss-08',
      'base:boss/boss-09',
      'base:boss/boss-10',
      'base:boss/boss-11',
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
  equipmentDeparturePolicies: [{
    schemaVersion: 1,
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    policyId: 'resource-12-combat-removal',
    priority: 100,
    equipmentDefinitionIds: ['base:resource/resource-12'],
    cause: 'combat-discard',
    disposition: 'remove-from-game',
    reasonCode: 'RESOURCE_12_WEARER_COMBAT_DISCARD_REMOVES_EQUIPMENT',
  }],
  combatParticipantDeparturePolicies: [{
    schemaVersion: 1,
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    policyId: 'boss-02-participant-departure',
    priority: 100,
    targetDefinitionIds: ['base:boss/boss-02'],
    dispositions: [
      { definitionTypes: ['starter'], destination: { kind: 'remove-from-game' } },
      { definitionTypes: ['adventurer'], destination: { kind: 'shuffle-into-shared-deck', zoneId: 'base:adventurer-deck' } },
    ],
    replacementDraw: { sourceZoneId: 'base:adventurer-deck', destination: 'discardPile', count: 'participant-count' },
    reasonCode: 'BOSS_02_REPLACES_COMBAT_PARTICIPANTS',
  }],
  partyCombatModifierRules: [
    partyCombatModifier('adventurer-04-first-other-bonus', 'adventurer-04', 10, 'first', { kind: 'fixed', value: 2 }),
    partyCombatModifier('adventurer-10-first-self-bonus', 'adventurer-10', 20, 'source', { kind: 'fixed', value: 2 }, { kind: 'source-position-in', positions: [1] }),
    partyCombatModifier('adventurer-15-rear-self-bonus', 'adventurer-15', 30, 'source', { kind: 'fixed', value: 1 }, { kind: 'source-position-in', positions: [4, 5] }),
    partyCombatModifier('adventurer-20-party-size-penalty', 'adventurer-20', 40, 'source', { kind: 'per-other-party-member', value: -1 }),
    partyCombatModifier('adventurer-24-monster-self-bonus', 'adventurer-24', 50, 'source', { kind: 'fixed', value: 3 }, { kind: 'target-kind-in', kinds: ['monster'] }),
    partyCombatModifier('adventurer-27-adjacent-bonus', 'adventurer-27', 60, 'adjacent', { kind: 'fixed', value: 1 }),
  ],
  combatRules: [
    {
      schemaVersion: 1,
      ruleId: 'boss-01-item-row-equipment-combat',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 10,
      kind: 'modifier',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-01'] },
      amount: { kind: 'public-zone-card-count', zoneId: 'base:item-row', definitionTypes: ['equipment'], multiplier: 1 },
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-05-equipment-suppression',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 20,
      kind: 'equipment-suppression',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-05'] },
      reasonCode: 'BOSS_05_SUPPRESSES_ALL_EQUIPMENT',
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-06-attacking-party-professions-combat',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 30,
      kind: 'modifier',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-06'] },
      amount: { kind: 'distinct-party-tag-count', player: 'attacking-player', tagPrefix: 'profession:', multiplier: 1 },
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-08-three-participant-limit',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 40,
      kind: 'participant-limit',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-08'] },
      maximumPartySlots: 3,
      reasonCode: 'BOSS_08_MAXIMUM_THREE_ADVENTURERS',
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-09-next-seat-professions-combat',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 50,
      kind: 'modifier',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-09'] },
      amount: { kind: 'distinct-party-tag-count', player: 'next-seat', tagPrefix: 'profession:', multiplier: 1 },
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-10-attacking-party-professions-combat',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 60,
      kind: 'modifier',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-10'] },
      amount: { kind: 'distinct-party-tag-count', player: 'attacking-player', tagPrefix: 'profession:', multiplier: -1 },
    },
    {
      schemaVersion: 1,
      ruleId: 'boss-11-one-participant-limit',
      moduleId: baseProvisionalOriginalFullRulesModuleId,
      priority: 70,
      kind: 'participant-limit',
      when: { kind: 'target-definition-id-in', definitionIds: ['base:boss/boss-11'] },
      maximumPartySlots: 1,
      reasonCode: 'BOSS_11_FIRST_ADVENTURER_ONLY',
    },
  ],
  purchaseCostModifierRules: [{
    schemaVersion: 1,
    ruleId: 'adventurer-05-equipment-discount',
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    priority: 100,
    activation: { kind: 'definition-in-player-party', player: 'evaluated-player', definitionId: 'base:adventurer/adventurer-05' },
    target: { kind: 'definition-type-in', values: ['equipment'] },
    amount: -1,
  }],
  diceDefinitions: [{
    schemaVersion: 1,
    moduleId: baseProvisionalOriginalFullRulesModuleId,
    diceId: 'monster-02-reward-d6',
    sides: 6,
  }],
  combatRewardPolicies: [
    reward(
      'boss-01-purchase-and-market-cards',
      'base:boss/boss-01',
      5,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        publicRowCardsReward('base:boss/boss-01-market-reward', 'base:item-row', 4, 2, ['item', 'equipment']),
      ] },
    ),
    reward(
      'boss-02-purchase-and-adventurer-deck',
      'base:boss/boss-02',
      7,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        sharedDeckCardsReward('base:adventurer-deck', 2),
      ] },
    ),
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
    reward(
      'boss-03-hand-adventurer-gate-and-reward',
      'base:boss/boss-03',
      45,
      {
        kind: 'choose-card',
        choiceId: 'base:boss/boss-03-hand-adventurer-cost',
        decisionKind: 'discard-card',
        actor: { kind: 'controller' },
        from: hand,
        predicate: { kind: 'tag-prefix', value: 'profession:' },
        selectedCardKey: 'base:boss/boss-03-hand-adventurer',
        zeroCandidateEffect: { kind: 'mark-combat-failed', reasonCode: 'BOSS_03_REQUIRED_HAND_ADVENTURER_MISSING' },
        effect: {
          kind: 'sequence',
          effects: [
            { kind: 'discard-card', card: { kind: 'context-card', key: 'base:boss/boss-03-hand-adventurer' }, from: hand },
            { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
            optionalRemoval('base:boss/boss-03-remove-first', [discardPile]),
            optionalRemoval('base:boss/boss-03-remove-second', [discardPile]),
          ],
        },
      },
    ),
    reward(
      'boss-05-purchase-and-market-cards',
      'base:boss/boss-05',
      50,
      {
        kind: 'sequence',
        effects: [
          { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
          publicRowCardsReward('base:boss/boss-05-market-reward', 'base:item-row', 3, 2),
        ],
      },
    ),
    reward(
      'boss-06-purchase-and-adventurer-deck',
      'base:boss/boss-06',
      55,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        sharedDeckCardsReward('base:adventurer-deck', 2),
      ] },
    ),
    reward(
      'boss-08-purchase-and-adventurers',
      'base:boss/boss-08',
      60,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        publicRowCardsReward('base:boss/boss-08-adventurer-reward', 'base:adventurer-row', 3, 2, ['adventurer']),
      ] },
    ),
    reward(
      'boss-09-purchase-and-item-deck',
      'base:boss/boss-09',
      65,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        sharedDeckCardsReward('base:item-deck', 1),
      ] },
    ),
    reward(
      'boss-10-purchase-and-personal-draw',
      'base:boss/boss-10',
      68,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        { kind: 'draw', player: { kind: 'controller' }, count: 3 },
      ] },
    ),
    reward(
      'boss-11-purchase-and-items',
      'base:boss/boss-11',
      70,
      { kind: 'sequence', effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        publicRowCardsReward('base:boss/boss-11-item-reward', 'base:item-row', 3, 2, ['item']),
      ] },
    ),
  ],
  getPartyLimit: (_state, _player, currentLimit) => currentLimit,
  onSupplyDepleted: () => 'handled',
};
