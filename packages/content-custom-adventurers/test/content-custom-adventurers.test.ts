import { describe, expect, it } from 'vitest';
import { baseProvisionalOriginalFullCapabilityMatrix, baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseRulesModule, createContentRegistry, createGame, createRuleset } from '@guildmaster/game-engine';
import {
  customAdventurerCapabilityMatrix,
  customAdventurerContentPack,
  customAdventurerMechanicBindings,
  customCardRows,
} from '../src/index.js';

describe('custom adventurer content', () => {
  it('uses all five approved custom balance values', () => {
    const valuesById = Object.fromEntries(customCardRows.map(([
      id,
      ,
      ,
      cost,
      combat,
      honor,
    ]) => [id, { cost, combat, honor }]));

    expect(valuesById).toMatchObject({
      'custom:adventurer/melee-08': { cost: 4, combat: 2, honor: 2 },
      'custom:adventurer/mage-08': { cost: 4, combat: 1, honor: 1 },
      'custom:adventurer/tank-08': { cost: 4, combat: 2, honor: 2 },
      'custom:adventurer/ranged-04': { cost: 4, combat: 3, honor: 2 },
      'custom:adventurer/tank-09': { cost: 4, combat: 1, honor: 1 },
    });
  });

  it('keeps the base roster at two copies but builds the custom-mode roster with one copy each', () => {
    expect(customAdventurerContentPack.manifest).toMatchObject({
      id: 'custom:adventurers-full',
      role: 'expansion',
      dependencies: ['base:provisional-original-full'],
    });
    expect(customCardRows.filter(([id]) => id.startsWith('custom:starter/'))).toHaveLength(5);
    const customAdventurers = customCardRows.filter(([id]) => id.startsWith('custom:adventurer/'));
    expect(customAdventurers).toHaveLength(40);
    expect(customAdventurers.every(([, , copies]) => copies === 1)).toBe(true);
    expect(baseProvisionalOriginalFullContentPack.definitions
      .filter(({ id, type }) => type === 'adventurer' && id.startsWith('base:adventurer/'))
      .reduce((total, definition) => total + definition.copies, 0)).toBe(60);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked').map(({ contentId }) => contentId)).toEqual([]);
    expect(customAdventurerCapabilityMatrix.filter(({ enabled }) => enabled)).toHaveLength(40);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'none')).toEqual([]);
    expect(customAdventurerCapabilityMatrix.every(({ mechanicFamily, cpuResolver, ruleEvidence, testIds }) => mechanicFamily.length > 0 && cpuResolver.length > 0 && ruleEvidence.length > 0 && testIds.length > 0)).toBe(true);
    expect(customAdventurerCapabilityMatrix.every(({ ruleEvidence }) => ruleEvidence.includes('docs/card-data/自定義冒險者格式化資料.md'))).toBe(true);
    expect(Object.keys(customAdventurerMechanicBindings)).toHaveLength(30);
    expect(customAdventurerContentPack.replacements?.filter(({ replacesDefinitionId }) => replacesDefinitionId.startsWith('base:adventurer/')))
      .toEqual(Object.entries(customAdventurerMechanicBindings).map(([replacesDefinitionId, replacementDefinitionId]) => ({
        replacesDefinitionId,
        replacementDefinitionId,
        priority: 100,
      })));

    for (const [baseId, customId] of Object.entries(customAdventurerMechanicBindings)) {
      const baseCapability = baseProvisionalOriginalFullCapabilityMatrix.find(({ contentId }) => contentId === baseId)!;
      const customCapability = customAdventurerCapabilityMatrix.find(({ contentId }) => contentId === customId)!;
      expect(customCapability.decisionKinds).toEqual(baseCapability.decisionKinds);
      expect(customCapability.testIds).toEqual(expect.arrayContaining([...baseCapability.testIds]));
    }
  });

  it('replaces the base starter and adventurer roster without duplicating definitions', () => {
    const registry = createContentRegistry(
      [baseProvisionalOriginalFullContentPack, customAdventurerContentPack],
      { allowProvisionalPlaytest: true },
    );
    expect(Object.keys(registry.definitions).filter((id) => id.startsWith('base:adventurer/'))).toHaveLength(0);
    expect(Object.keys(registry.definitions).filter((id) => id.startsWith('custom:adventurer/'))).toHaveLength(40);
    expect(Object.keys(registry.definitions)).not.toEqual(expect.arrayContaining([
      'custom:adventurer/tank-10',
      'custom:adventurer/support-10',
      'custom:adventurer/ranged-06',
    ]));
    expect('partyDefinitionIds' in registry.starter ? registry.starter.partyDefinitionIds : []).toEqual([
      'custom:starter/support',
      'custom:starter/melee',
      'custom:starter/mage',
      'custom:starter/tank',
      'custom:starter/ranged',
    ]);
  });

  it('builds the expected forty-card custom-mode public adventurer supply', () => {
    const ruleset = createRuleset(
      [baseProvisionalOriginalFullContentPack, customAdventurerContentPack],
      [baseRulesModule],
      { allowProvisionalPlaytest: true },
    );
    const state = createGame({
      gameId: 'custom-roster',
      seed: 18,
      players: Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, kind: index === 0 ? 'human' as const : 'ai' as const })),
    }, ruleset);
    const publicAdventurers = [...state.zones['base:adventurer-deck']!.cardIds, ...state.zones['base:adventurer-row']!.cardIds];
    expect(publicAdventurers).toHaveLength(40);
    expect(publicAdventurers.every((cardId) => state.cards[cardId]!.definitionId.startsWith('custom:adventurer/'))).toBe(true);
    expect(state.players.every(({ party }) => party.every(({ adventurerId }) => state.cards[adventurerId]!.definitionId.startsWith('custom:starter/')))).toBe(true);
  });
});
