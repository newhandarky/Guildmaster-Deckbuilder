import { baseRulesModule, type RulesModule } from '@guildmaster/game-engine';
import type { CardDefinition, ContentPack } from '@guildmaster/game-protocol';

export const baseHelperZoneIds = {
  deck: 'base:helper-deck',
  active: 'base:helper-active',
  retired: 'base:helper-retired',
} as const;

export const baseHelperIds = Array.from(
  { length: 12 },
  (_, index) => `base:helper/helper-${String(index + 1).padStart(2, '0')}`,
) as readonly string[];

export const enabledBaseHelperDefinitionIds = [
  'base:helper/helper-01',
  'base:helper/helper-06',
  'base:helper/helper-07',
  'base:helper/helper-08',
  'base:helper/helper-09',
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
    version: '0.2.0',
    hash: 'base-provisional-helpers-v2-batch-a',
    role: 'expansion',
    contentStatus: 'provisional-playtest',
    dependencies: ['base:provisional-foundation'],
  },
  definitions,
  rulesModuleIds: ['base:helpers'],
};

export const baseHelpersRulesModule: RulesModule = {
  id: 'base:helpers',
  version: '1.1.0',
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
  lifecycleHooks: [{
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
          { kind: 'refresh-supply-row', refreshPolicyId: 'base:rotate-helper' },
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
