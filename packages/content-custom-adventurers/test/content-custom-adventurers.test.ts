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
  it('keeps the base roster at two copies but builds the custom-mode roster with one copy each', () => {
    expect(customAdventurerContentPack.manifest).toMatchObject({
      id: 'custom:adventurers-full',
      role: 'expansion',
      dependencies: ['base:provisional-original-full'],
    });
    expect(customCardRows.filter(([id]) => id.startsWith('custom:starter/'))).toHaveLength(5);
    expect(customCardRows.filter(([id, , copies]) => id.startsWith('custom:adventurer/') && copies === 1)).toHaveLength(43);
    expect(baseProvisionalOriginalFullContentPack.definitions
      .filter(({ id, type }) => type === 'adventurer' && id.startsWith('base:adventurer/'))
      .reduce((total, definition) => total + definition.copies, 0)).toBe(60);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked').map(({ contentId }) => contentId)).toEqual([]);
    expect(customAdventurerCapabilityMatrix.filter(({ enabled }) => enabled)).toHaveLength(43);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'none').map(({ contentId }) => contentId)).toEqual([
      'custom:adventurer/tank-10',
      'custom:adventurer/support-10',
      'custom:adventurer/ranged-06',
    ]);
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
    expect(Object.keys(registry.definitions).filter((id) => id.startsWith('custom:adventurer/'))).toHaveLength(43);
    expect('partyDefinitionIds' in registry.starter ? registry.starter.partyDefinitionIds : []).toEqual([
      'custom:starter/support',
      'custom:starter/melee',
      'custom:starter/mage',
      'custom:starter/tank',
      'custom:starter/ranged',
    ]);
  });

  it('builds the expected forty-three-card custom-mode public adventurer supply', () => {
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
    expect(publicAdventurers).toHaveLength(43);
    expect(state.players.every(({ party }) => party.every(({ adventurerId }) => state.cards[adventurerId]!.definitionId.startsWith('custom:starter/')))).toBe(true);
  });
});
