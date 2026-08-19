import { baseRulesModule, type RulesModule } from '@guildmaster/game-engine';
import type { CardDefinition, ContentPack, EffectCardPredicate, EffectDefinition, LifecycleActivation } from '@guildmaster/game-protocol';

export const baseHelperZoneIds = {
  deck: 'base:helper-deck',
  active: 'base:helper-active',
  retired: 'base:helper-retired',
  draft: 'base:helper-draft',
} as const;

export const baseHelperIds = Array.from(
  { length: 12 },
  (_, index) => `base:helper/helper-${String(index + 1).padStart(2, '0')}`,
) as readonly string[];

export const enabledBaseHelperDefinitionIds = [
  'base:helper/helper-01',
  'base:helper/helper-02',
  'base:helper/helper-03',
  'base:helper/helper-04',
  'base:helper/helper-05',
  'base:helper/helper-06',
  'base:helper/helper-07',
  'base:helper/helper-08',
  'base:helper/helper-09',
  'base:helper/helper-10',
  'base:helper/helper-11',
  'base:helper/helper-12',
] as const;
export const enabledBaseHelperDefinitionId = 'base:helper/helper-08';

const definitions: readonly CardDefinition[] = baseHelperIds.map((id, index) => {
  const sequence = String(index + 1).padStart(2, '0');
  const enabled = enabledBaseHelperDefinitionIds.includes(id as (typeof enabledBaseHelperDefinitionIds)[number]);
  return {
    id,
    name: `候選協助者 ${sequence}`,
    type: 'helper',
    copies: 1,
    source: 'provisional-helper-playtest',
    tags: ['playtest:helper', enabled ? 'playtest:effect-enabled' : 'playtest:effects-disabled'],
  };
});

export const baseProvisionalHelpersContentPack: ContentPack = {
  manifest: {
    id: 'base:provisional-helpers',
    version: '0.3.0',
    hash: 'base-provisional-helpers-v3-lifecycle-effects',
    role: 'expansion',
    contentStatus: 'provisional-playtest',
    dependencies: ['base:provisional-foundation'],
  },
  definitions,
  rulesModuleIds: ['base:helpers'],
};

const activeHelper = (definitionId: string): LifecycleActivation => ({ kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId });
const helperDiscard = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const;
const helperHand = { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } as const;
const recoverToDeckTop = (choiceId: string, predicate: EffectCardPredicate): EffectDefinition['body'] => ({
  kind: 'choose-card',
  choiceId,
  decisionKind: 'recover-card',
  actor: { kind: 'controller' },
  from: helperDiscard,
  predicate,
  selectedCardKey: 'recovered',
  skipOptionId: `${choiceId}:skip`,
  zeroCandidateBehavior: 'skip',
  effect: {
    kind: 'move-card',
    card: { kind: 'context-card', key: 'recovered' },
    from: helperDiscard,
    to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'drawPile' },
    position: 'top',
  },
});
const draftChoices = (timing: string, index = 0): EffectDefinition['body'] => {
  const selectedKey = `helper12Draft${index}`;
  const move: EffectDefinition['body'] = {
    kind: 'move-card', card: { kind: 'context-card', key: selectedKey }, from: { kind: 'shared-zone', zoneId: baseHelperZoneIds.draft },
    to: { kind: 'player-zone', player: { kind: 'context-player', key: `draftPlayer${index}` }, zone: 'hand' }, transferOwnership: true,
  };
  return {
    kind: 'choose-card', choiceId: `base:helper/helper-12-${timing}-draft-${index + 1}`, decisionKind: 'draft-card',
    actor: { kind: 'context-player', key: `draftPlayer${index}` }, from: { kind: 'shared-zone', zoneId: baseHelperZoneIds.draft },
    selectedCardKey: selectedKey, zeroCandidateBehavior: 'skip',
    effect: index >= 3 ? move : { kind: 'sequence', effects: [move, draftChoices(timing, index + 1)] },
  };
};
const helper12Draft = (timing: 'enter' | 'leave'): EffectDefinition['body'] => ({
  kind: 'choice', choiceId: `base:helper/helper-12-${timing}-deck`, decisionKind: 'choose-effect-option', actor: { kind: 'controller' }, options: [
    { id: 'adventurer-deck', effect: { kind: 'sequence', effects: [{ kind: 'reveal-shared-deck-to-zone', sourceZoneId: 'base:adventurer-deck', destinationZoneId: baseHelperZoneIds.draft, count: { kind: 'player-count' } }, draftChoices(timing)] } },
    { id: 'item-deck', effect: { kind: 'sequence', effects: [{ kind: 'reveal-shared-deck-to-zone', sourceZoneId: 'base:item-deck', destinationZoneId: baseHelperZoneIds.draft, count: { kind: 'player-count' } }, draftChoices(timing)] } },
  ],
});

export const baseHelpersRulesModule: RulesModule = {
  id: 'base:helpers',
  version: '1.2.0',
  config: { enabledHelperDefinitionIds: [...enabledBaseHelperDefinitionIds] },
  composition: {
    schemaVersion: 1,
    kind: 'optional',
    priority: 10,
    dependencies: [{ moduleId: baseRulesModule.id, version: baseRulesModule.version }],
  },
  createInitialState: () => ({ schemaVersion: 1 }),
  validateState: (state) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return ['state must be an object.'];
    const record = state as Record<string, unknown>;
    return record.schemaVersion === 1 && Object.keys(record).length === 1
      ? []
      : ['state must equal { schemaVersion: 1 }.'];
  },
  zoneDefinitions: [
    { zoneId: baseHelperZoneIds.deck, kind: 'orderedDeck', visibility: 'hidden', rulesModuleId: 'base:helpers' },
    { zoneId: baseHelperZoneIds.active, kind: 'singleSlot', visibility: 'public', rulesModuleId: 'base:helpers' },
    { zoneId: baseHelperZoneIds.retired, kind: 'moduleArea', visibility: 'public', rulesModuleId: 'base:helpers' },
    { zoneId: baseHelperZoneIds.draft, kind: 'moduleArea', visibility: 'public', rulesModuleId: 'base:helpers' },
  ],
  setupContributions: [{
    schemaVersion: 1,
    contributionId: 'base:helper-pool',
    moduleId: 'base:helpers',
    priority: 10,
    selector: { kind: 'definition-type', value: 'helper' },
    count: { kind: 'zone-card-count', zoneIds: ['base:boss-deck', 'base:boss-row'] },
    destinationZoneId: baseHelperZoneIds.deck,
    order: 'deterministic-shuffle',
  }],
  supplyRowConfigurations: [{
    schemaVersion: 1,
    configurationId: 'base:helper-row',
    moduleId: 'base:helpers',
    priority: 10,
    supply: 'base:helper',
    sourceDeckZoneId: baseHelperZoneIds.deck,
    targetRowZoneId: baseHelperZoneIds.active,
    targetSize: 1,
    mode: 'refill-to-target',
  }],
  supplyRowRefreshPolicies: [{
    schemaVersion: 1,
    refreshPolicyId: 'base:rotate-helper',
    moduleId: 'base:helpers',
    priority: 10,
    supplyRowConfigurationId: 'base:helper-row',
    destinationZoneId: baseHelperZoneIds.retired,
    ordering: 'preserve-top',
    refill: true,
    reasonCode: 'BOSS_DEFEATED',
  }],
  teamCapacityEnforcementPolicies: [{
    schemaVersion: 1,
    policyId: 'base:enforce-helper-capacity',
    moduleId: 'base:helpers',
    priority: 10,
    playerScope: 'all-players',
    mode: 'discard-newest',
    reasonCode: 'HELPER_CAPACITY_REDUCED',
  }],
  purchaseCostModifierRules: [
    {
      schemaVersion: 1,
      ruleId: 'base:helper-01-supply-discount',
      moduleId: 'base:helpers',
      priority: 10,
      activation: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-01' },
      target: { kind: 'definition-type-in', values: ['item', 'equipment'] },
      amount: -1,
    },
    {
      schemaVersion: 1,
      ruleId: 'base:helper-06-adventurer-discount',
      moduleId: 'base:helpers',
      priority: 20,
      activation: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-06' },
      target: { kind: 'definition-type-in', values: ['adventurer'] },
      amount: -1,
    },
    {
      schemaVersion: 1,
      ruleId: 'base:helper-09-equipment-discount',
      moduleId: 'base:helpers',
      priority: 30,
      activation: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-09' },
      target: { kind: 'definition-type-in', values: ['equipment'] },
      amount: -1,
    },
  ],
  restHandSizePolicies: [{
    schemaVersion: 1,
    policyId: 'base:helper-07-rest-six',
    moduleId: 'base:helpers',
    priority: 10,
    activation: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-07' },
    playerScope: 'active-player',
    mode: 'replace',
    handSize: 6,
  }],
  lifecycleHooks: [
  {
    schemaVersion: 1,
    hookId: 'helper-12-initial-draft',
    moduleId: 'base:helpers',
    point: 'game-start',
    kind: 'trigger',
    priority: 10,
    activation: activeHelper('base:helper/helper-12'),
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-12-initial-draft', body: helper12Draft('enter') },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-02-recover-item-at-rest',
    moduleId: 'base:helpers',
    point: 'phase-end',
    kind: 'trigger',
    priority: 20,
    activation: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'rest' }, activeHelper('base:helper/helper-02')] },
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-02-recover-item-at-rest', body: recoverToDeckTop('base:helper/helper-02-recover-item', { kind: 'definition-type-in', values: ['item'] }) },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-03-reveal-enemies-at-purchase-start',
    moduleId: 'base:helpers',
    point: 'phase-start',
    kind: 'trigger',
    priority: 25,
    activation: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'purchase' }, activeHelper('base:helper/helper-03')] },
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-03-reveal-enemies-at-purchase-start', body: {
      kind: 'reveal-player-deck-until', player: { kind: 'controller' }, predicate: { kind: 'definition-type-in', values: ['monster', 'boss'] }, matchingDestination: 'hand',
    } },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-04-purchase-per-party',
    moduleId: 'base:helpers',
    point: 'phase-start',
    kind: 'trigger',
    priority: 30,
    activation: { kind: 'all', conditions: [
      { kind: 'phase-is', phase: 'purchase' },
      activeHelper('base:helper/helper-04'),
      { kind: 'any', conditions: [{ kind: 'turn-fact-at-least', fact: 'monstersDefeated', amount: 1 }, { kind: 'turn-fact-at-least', fact: 'bossesDefeated', amount: 1 }] },
    ] },
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-04-purchase-per-party', body: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: { kind: 'party-card-count', player: { kind: 'controller' } } } },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-05-recover-adventurer-at-turn-start',
    moduleId: 'base:helpers',
    point: 'turn-start',
    kind: 'trigger',
    priority: 40,
    activation: activeHelper('base:helper/helper-05'),
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-05-recover-adventurer-at-turn-start', body: {
      kind: 'choose-card', choiceId: 'base:helper/helper-05-recover-adventurer', decisionKind: 'recover-card', actor: { kind: 'controller' }, from: helperDiscard,
      predicate: { kind: 'definition-type-in', values: ['adventurer'] }, selectedCardKey: 'recovered', skipOptionId: 'base:helper/helper-05-recover-adventurer:skip', zeroCandidateBehavior: 'skip',
      effect: { kind: 'move-card', card: { kind: 'context-card', key: 'recovered' }, from: helperDiscard, to: helperHand },
    } },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-10-recover-equipment-at-rest',
    moduleId: 'base:helpers',
    point: 'phase-end',
    kind: 'trigger',
    priority: 50,
    activation: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'rest' }, activeHelper('base:helper/helper-10')] },
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-10-recover-equipment-at-rest', body: recoverToDeckTop('base:helper/helper-10-recover-equipment', { kind: 'definition-type-in', values: ['equipment'] }) },
  },
  {
    schemaVersion: 1,
    hookId: 'helper-11-pass-card-at-turn-start',
    moduleId: 'base:helpers',
    point: 'turn-start',
    kind: 'trigger',
    priority: 60,
    activation: activeHelper('base:helper/helper-11'),
    effect: { schemaVersion: 1, effectId: 'base:helpers/helper-11-pass-card-at-turn-start', body: {
      kind: 'choose-card', choiceId: 'base:helper/helper-11-pass-card', decisionKind: 'transfer-card', actor: { kind: 'controller' }, from: helperHand,
      selectedCardKey: 'transferred', zeroCandidateBehavior: 'skip', effect: {
        kind: 'move-card', card: { kind: 'context-card', key: 'transferred' }, from: helperHand,
        to: { kind: 'player-zone', player: { kind: 'context-player', key: 'leftPlayer' }, zone: 'hand' }, transferOwnership: true,
      },
    } },
  },
  {
    schemaVersion: 1,
    hookId: 'rotate-after-boss-defeat',
    moduleId: 'base:helpers',
    point: 'event-after',
    kind: 'trigger',
    eventType: 'ENEMY_DEFEATED',
    priority: 100,
    activation: { kind: 'metadata-equals', key: 'targetKind', value: 'boss' },
    effect: {
      schemaVersion: 1,
      effectId: 'base:helpers/rotate-after-boss-defeat',
      body: {
        kind: 'sequence',
        effects: [
          { kind: 'conditional', condition: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-12' }, whenTrue: helper12Draft('leave') },
          { kind: 'refresh-supply-row', refreshPolicyId: 'base:rotate-helper' },
          { kind: 'conditional', condition: { kind: 'definition-in-zone', zoneId: baseHelperZoneIds.active, definitionId: 'base:helper/helper-12' }, whenTrue: helper12Draft('enter') },
          { kind: 'enforce-team-capacity', policyId: 'base:enforce-helper-capacity' },
        ],
      },
    },
  }],
  getPartyLimit: (state, _player, limit) => {
    const activeId = state.zones[baseHelperZoneIds.active]?.cardIds[0];
    return activeId && state.cards[activeId]?.definitionId === enabledBaseHelperDefinitionId ? limit + 1 : limit;
  },
  onSupplyDepleted: () => 'handled',
};
