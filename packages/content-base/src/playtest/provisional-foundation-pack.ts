import type { CardDefinition, ContentPack } from '@guildmaster/game-protocol';

/**
 * First internal-only base-content slice.
 *
 * It intentionally exposes audited candidates under neutral display names. The
 * enabled item effects are data-driven; all other card text stays explicitly
 * disabled and the pack can only be loaded through allowProvisionalPlaytest.
 */
const source = 'provisional-foundation-playtest';
const foundationRuntimeDefinitions: readonly CardDefinition[] = [
  { id: 'base:starter/adventurer-01', name: '候選起始冒險者 01', type: 'starter', copies: 1, source, tags: ['profession:support'], combat: 1 },
  { id: 'base:starter/adventurer-02', name: '候選起始冒險者 02', type: 'starter', copies: 1, source, tags: ['profession:melee'], combat: 2 },
  { id: 'base:starter/adventurer-03', name: '候選起始冒險者 03', type: 'starter', copies: 1, source, tags: ['profession:mage'], combat: 1 },
  { id: 'base:starter/adventurer-04', name: '候選起始冒險者 04', type: 'starter', copies: 1, source, tags: ['profession:tank'], combat: 1 },
  { id: 'base:starter/adventurer-05', name: '候選起始冒險者 05', type: 'starter', copies: 1, source, tags: ['profession:ranged'], combat: 1 },
  { id: 'base:starter/summoning-stone', name: '候選起始資源 A', type: 'starter', copies: 1, source, tags: [], purchasePower: 1 },
  { id: 'base:starter/spirit-crystal', name: '候選起始裝備 B', type: 'equipment', copies: 1, source, tags: [], combat: 1 },
  { id: 'base:adventurer/adventurer-01', name: '候選冒險者 01', type: 'adventurer', copies: 2, source, tags: ['profession:support', 'playtest:effects-disabled'], cost: 4, combat: 2, honor: 2 },
  { id: 'base:adventurer/adventurer-02', name: '候選冒險者 02', type: 'adventurer', copies: 2, source, tags: ['profession:melee', 'playtest:effects-disabled'], cost: 3, combat: 3, honor: 2 },
  { id: 'base:adventurer/adventurer-03', name: '候選冒險者 03', type: 'adventurer', copies: 2, source, tags: ['profession:mage', 'playtest:effects-disabled'], cost: 4, combat: 3, honor: 1 },
  { id: 'base:adventurer/adventurer-04', name: '候選冒險者 04', type: 'adventurer', copies: 2, source, tags: ['profession:tank', 'playtest:effects-disabled'], cost: 4, combat: 2, honor: 2 },
  { id: 'base:adventurer/adventurer-05', name: '候選冒險者 05', type: 'adventurer', copies: 2, source, tags: ['profession:support', 'playtest:effects-disabled'], cost: 3, combat: 1, honor: 1 },
  { id: 'base:adventurer/adventurer-06', name: '候選冒險者 06', type: 'adventurer', copies: 2, source, tags: ['profession:melee', 'playtest:effects-disabled'], cost: 4, combat: 2, honor: 2 },
  { id: 'base:adventurer/adventurer-07', name: '候選冒險者 07', type: 'adventurer', copies: 2, source, tags: ['profession:ranged', 'playtest:effects-disabled'], cost: 3, combat: 2, honor: 1 },
  { id: 'base:adventurer/adventurer-08', name: '候選冒險者 08', type: 'adventurer', copies: 2, source, tags: ['profession:melee', 'playtest:effects-disabled'], cost: 3, combat: 2, honor: 1 },
  { id: 'base:resource/resource-01', name: '候選物資 01', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 3, honor: 1 },
  { id: 'base:resource/resource-02', name: '候選物資 02', type: 'equipment', copies: 2, source, tags: ['playtest:effects-disabled'], cost: 3, combat: 1, honor: 2 },
  { id: 'base:resource/resource-04', name: '候選物資 04', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 2, honor: 1 },
  { id: 'base:resource/resource-05', name: '候選物資 05', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 3, honor: 1 },
  { id: 'base:resource/resource-08', name: '候選物資 08', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 4, honor: 1 },
  { id: 'base:resource/resource-10', name: '候選物資 10', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 3, honor: 1 },
  { id: 'base:resource/resource-13', name: '候選物資 13', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 3, honor: 1 },
  { id: 'base:resource/resource-15', name: '候選物資 15', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 4, honor: 1 },
  { id: 'base:resource/resource-17', name: '候選物資 17', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 4, honor: 2 },
  { id: 'base:resource/resource-18', name: '候選物資 18', type: 'equipment', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 4, combat: 2, honor: 1 },
  { id: 'base:resource/resource-27', name: '候選物資 27', type: 'item', copies: 2, source, tags: ['playtest:effect-enabled'], cost: 5, honor: 2 },
  { id: 'base:monster/monster-01', name: '候選魔物 01', type: 'monster', copies: 3, source, tags: ['base:supply-cycle-anchor', 'playtest:effects-disabled'], combat: 5, purchasePower: 2, honor: 1 },
  { id: 'base:monster/monster-02', name: '候選魔物 02', type: 'monster', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 5, purchasePower: 2, honor: 5 },
  { id: 'base:monster/monster-03', name: '候選魔物 03', type: 'monster', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 6, purchasePower: 2, honor: 5 },
  { id: 'base:monster/monster-04', name: '候選魔物 04', type: 'monster', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 5, purchasePower: 2, honor: 4 },
  { id: 'base:boss/boss-01', name: '候選魔王 01', type: 'boss', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 9, purchasePower: 3, honor: 10 },
  { id: 'base:boss/boss-02', name: '候選魔王 02', type: 'boss', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 9, purchasePower: 3, honor: 10 },
  { id: 'base:boss/boss-03', name: '候選魔王 03', type: 'boss', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 10, purchasePower: 3, honor: 10 },
  { id: 'base:boss/boss-04', name: '候選魔王 04', type: 'boss', copies: 1, source, tags: ['playtest:effects-disabled'], combat: 5, purchasePower: 3, honor: 10 },
];

function definitionFor(runtimeDefinition: CardDefinition): CardDefinition {
  const definition = structuredClone(runtimeDefinition);
  const candidate = { definitionId: definition.id };
  if (candidate.definitionId === 'base:resource/resource-01') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-01-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-01-recover-adventurer',
        decisionKind: 'recover-card',
        actor: { kind: 'controller' },
        from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
        predicate: { kind: 'definition-type-in', values: ['adventurer'] },
        selectedCardKey: 'recovered',
        effect: {
          kind: 'move-card',
          card: { kind: 'context-card', key: 'recovered' },
          from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
          to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
        },
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-04') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-04-use',
      body: {
        kind: 'sequence',
        effects: [
          {
            kind: 'choose-card',
            choiceId: 'base:resource/resource-04-discard-boss',
            decisionKind: 'discard-card',
            actor: { kind: 'controller' },
            from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
            predicate: { kind: 'definition-type-in', values: ['boss'] },
            selectedCardKey: 'discard',
            effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'discard' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
          },
          { kind: 'draw', player: { kind: 'controller' }, count: 3 },
        ],
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-05') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-05-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-05-recover-equipment',
        decisionKind: 'recover-card',
        actor: { kind: 'controller' },
        from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
        predicate: { kind: 'definition-type-in', values: ['equipment'] },
        selectedCardKey: 'recovered',
        effect: {
          kind: 'move-card',
          card: { kind: 'context-card', key: 'recovered' },
          from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
          to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
        },
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-08') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-08-use',
      body: { kind: 'draw', player: { kind: 'controller' }, count: 2 },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-10') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-10-use',
      body: {
        kind: 'sequence',
        effects: [
          {
            kind: 'choose-card',
            choiceId: 'base:resource/resource-10-discard',
            decisionKind: 'discard-card',
            actor: { kind: 'controller' },
            from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
            selectedCardKey: 'discard',
            effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'discard' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
          },
          { kind: 'draw', player: { kind: 'controller' }, count: 2 },
        ],
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-13') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-13-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-13-recover-item-card',
        decisionKind: 'recover-card',
        actor: { kind: 'controller' },
        from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
        predicate: {
          kind: 'all',
          predicates: [
            { kind: 'definition-type-in', values: ['item'] },
            {
              kind: 'not',
              predicate: { kind: 'definition-id-in', values: ['base:resource/resource-13'] },
            },
          ],
        },
        selectedCardKey: 'recovered',
        effect: {
          kind: 'move-card',
          card: { kind: 'context-card', key: 'recovered' },
          from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
          to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
        },
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-15') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-15-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-15-remove',
        decisionKind: 'remove-card',
        actor: { kind: 'controller' },
        from: {
          kind: 'one-of',
          locations: [
            { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
            { kind: 'party', player: { kind: 'controller' } },
            { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
          ],
        },
        selectedCardKey: 'removed',
        selectedLocationKey: 'removedFrom',
        effect: {
          kind: 'remove-from-game',
          card: { kind: 'context-card', key: 'removed' },
          from: { kind: 'context-location', key: 'removedFrom' },
          attachedEquipmentDisposition: 'discard',
        },
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-17') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-17-use',
      body: {
        kind: 'sequence',
        effects: [
          { kind: 'draw', player: { kind: 'controller' }, count: 3 },
          {
            kind: 'choose-card',
            choiceId: 'base:resource/resource-17-discard',
            decisionKind: 'discard-card',
            actor: { kind: 'controller' },
            from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
            selectedCardKey: 'discard',
            effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'discard' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
          },
        ],
      },
    };
  }
  if (candidate.definitionId === 'base:resource/resource-18') {
    definition.equipmentEventTriggers = [{
      schemaVersion: 1,
      triggerId: 'base:resource/resource-18-after-defeat',
      point: 'event-after',
      eventType: 'ENEMY_DEFEATED',
      priority: 100,
      effect: {
        schemaVersion: 1,
        effectId: 'base:provisional-foundation/resource-18-after-defeat',
        body: { kind: 'draw', player: { kind: 'controller' }, count: 1 },
      },
    }];
  }
  if (candidate.definitionId === 'base:resource/resource-27') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-27-use',
      body: {
        kind: 'draw',
        player: { kind: 'controller' },
        count: {
          kind: 'party-distinct-tag-count',
          player: { kind: 'controller' },
          tagPrefix: 'profession:',
        },
      },
    };
  }
  return definition;
}

export const baseProvisionalFoundationContentPack: ContentPack = {
  manifest: {
    id: 'base:provisional-foundation',
    version: '0.11.0',
    hash: 'base-provisional-foundation-v11-resource-13-item-icon',
    role: 'base',
    contentStatus: 'provisional-playtest',
  },
  definitions: foundationRuntimeDefinitions.map(definitionFor),
  starter: {
    partyDefinitionIds: foundationRuntimeDefinitions.slice(0, 5).map(({ id }) => id),
    summonStoneDefinitionId: 'base:starter/summoning-stone',
    crystalDefinitionId: 'base:starter/spirit-crystal',
  },
  bonds: [1, 2, 3, 4, 4].map((requiredBosses, index) => ({
    id: `playtest:foundation-bond-${index + 1}`,
    name: `接線測試羈絆 ${index + 1}`,
    honor: index + 2,
    requiredBosses,
  })),
  rulesModuleIds: ['base:rules'],
};
