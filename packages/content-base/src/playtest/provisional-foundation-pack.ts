import type { CardDefinition, ContentPack } from '@guildmaster/game-protocol';
import { baseProvisionalContentCatalog } from '../provisional/base-provisional-catalog.js';
import type { ProvisionalCardCandidate, ProvisionalFieldName } from '../provisional/schema.js';

/**
 * First internal-only base-content slice.
 *
 * It intentionally exposes audited candidates under neutral display names. The
 * enabled item effects are data-driven; all other card text stays explicitly
 * disabled and the pack can only be loaded through allowProvisionalPlaytest.
 */
const foundationComposition = [
  ['base:starter/adventurer-01', 1],
  ['base:starter/adventurer-02', 1],
  ['base:starter/adventurer-03', 1],
  ['base:starter/adventurer-04', 1],
  ['base:starter/adventurer-05', 1],
  ['base:starter/summoning-stone', 1],
  ['base:starter/spirit-crystal', 1],
  ['base:adventurer/adventurer-01', 2],
  ['base:adventurer/adventurer-02', 2],
  ['base:adventurer/adventurer-03', 2],
  ['base:adventurer/adventurer-04', 2],
  ['base:adventurer/adventurer-05', 2],
  ['base:adventurer/adventurer-06', 2],
  ['base:adventurer/adventurer-07', 2],
  ['base:adventurer/adventurer-08', 2],
  // Internal digital playtest composition; source evidence does not establish per-card multiplicities.
  ['base:resource/resource-01', 2],
  ['base:resource/resource-02', 2],
  ['base:resource/resource-04', 2],
  ['base:resource/resource-05', 2],
  ['base:resource/resource-08', 2],
  ['base:resource/resource-10', 2],
  ['base:resource/resource-15', 2],
  ['base:resource/resource-17', 2],
  ['base:monster/monster-01', 3],
  ['base:monster/monster-02', 1],
  ['base:monster/monster-03', 1],
  ['base:monster/monster-04', 1],
  ['base:boss/boss-01', 1],
  ['base:boss/boss-02', 1],
  ['base:boss/boss-03', 1],
  ['base:boss/boss-04', 1],
] as const;

const candidates = new Map(baseProvisionalContentCatalog.candidates.map((candidate) => [candidate.definitionId, candidate]));
const numericFields = ['cost', 'combat', 'purchasePower', 'honor'] as const;
const enabledEffectIds = new Set([
  'base:resource/resource-01',
  'base:resource/resource-04',
  'base:resource/resource-05',
  'base:resource/resource-08',
  'base:resource/resource-10',
  'base:resource/resource-15',
  'base:resource/resource-17',
]);

function candidateFor(definitionId: string): ProvisionalCardCandidate {
  const candidate = candidates.get(definitionId);
  if (!candidate) throw new Error(`Missing provisional foundation candidate: ${definitionId}`);
  return candidate;
}

function numericValue(candidate: ProvisionalCardCandidate, fieldName: ProvisionalFieldName): number | undefined {
  const value = candidate.fields.find(({ field }) => field === fieldName)?.candidateValue;
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid numeric provisional foundation field: ${candidate.definitionId}.${fieldName}`);
  }
  return value;
}

function stringValue(candidate: ProvisionalCardCandidate, fieldName: ProvisionalFieldName): string | undefined {
  const value = candidate.fields.find(({ field }) => field === fieldName)?.candidateValue;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid string provisional foundation field: ${candidate.definitionId}.${fieldName}`);
  return value;
}

function neutralName(candidate: ProvisionalCardCandidate): string {
  const sequence = candidate.definitionId.split('-').at(-1) ?? '00';
  if (candidate.category === 'starter') return candidate.definitionId.includes('summoning-stone')
    ? '候選起始資源 A'
    : candidate.definitionId.includes('spirit-crystal')
      ? '候選起始資源 B'
      : `候選起始冒險者 ${sequence}`;
  const label = candidate.category === 'adventurer' ? '冒險者' : candidate.category === 'resource' ? '物資' : candidate.category === 'monster' ? '魔物' : '魔王';
  return `候選${label} ${sequence}`;
}

function definitionFor(definitionId: string, copies: number): CardDefinition {
  const candidate = candidateFor(definitionId);
  if (!['starter', 'adventurer', 'resource', 'monster', 'boss'].includes(candidate.category)) {
    throw new Error(`Unsupported provisional foundation category: ${candidate.category}`);
  }
  const cardType = candidate.category === 'resource' ? stringValue(candidate, 'cardType') : undefined;
  const profession = candidate.category === 'adventurer' ? stringValue(candidate, 'profession') : undefined;
  if (candidate.category === 'resource' && cardType !== 'item' && cardType !== 'equipment') throw new Error(`Unsupported provisional resource type: ${candidate.definitionId}.${cardType ?? '<missing>'}`);
  const effectEnabled = enabledEffectIds.has(candidate.definitionId);
  const definition: CardDefinition = {
    id: candidate.definitionId,
    name: neutralName(candidate),
    type: candidate.category === 'starter' ? 'starter' : candidate.category === 'resource' ? cardType! : candidate.category,
    copies,
    source: 'provisional-foundation-playtest',
    tags: [
      ...(candidate.mechanicsTags ?? []),
      ...(profession ? [`profession:${profession}`] : []),
      ...(candidate.category === 'starter' ? [] : [effectEnabled ? 'playtest:effect-enabled' : 'playtest:effects-disabled']),
    ],
  };
  for (const fieldName of numericFields) {
    const value = numericValue(candidate, fieldName);
    if (value !== undefined) definition[fieldName] = value;
  }
  if (candidate.definitionId === 'base:resource/resource-01') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-01-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-01-recover-adventurer',
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
  if (candidate.definitionId === 'base:resource/resource-15') {
    definition.useEffect = {
      schemaVersion: 1,
      effectId: 'base:provisional-foundation/resource-15-use',
      body: {
        kind: 'choose-card',
        choiceId: 'base:resource/resource-15-remove',
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
            actor: { kind: 'controller' },
            from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
            selectedCardKey: 'discard',
            effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'discard' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
          },
        ],
      },
    };
  }
  return definition;
}

export const baseProvisionalFoundationContentPack: ContentPack = {
  manifest: {
    id: 'base:provisional-foundation',
    version: '0.5.0',
    hash: 'base-provisional-foundation-v5-multi-source-removal',
    role: 'base',
    contentStatus: 'provisional-playtest',
  },
  definitions: foundationComposition.map(([definitionId, copies]) => definitionFor(definitionId, copies)),
  starter: {
    partyDefinitionIds: foundationComposition.slice(0, 5).map(([definitionId]) => definitionId),
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
