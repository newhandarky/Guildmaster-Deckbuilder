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
  it('contains five starters, forty-three two-copy adventurers, and six fail-closed effects', () => {
    expect(customAdventurerContentPack.manifest).toMatchObject({
      id: 'custom:adventurers-full',
      role: 'expansion',
      dependencies: ['base:provisional-original-full'],
    });
    expect(customCardRows.filter(([id]) => id.startsWith('custom:starter/'))).toHaveLength(5);
    expect(customCardRows.filter(([id, , copies]) => id.startsWith('custom:adventurer/') && copies === 2)).toHaveLength(43);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked').map(({ contentId }) => contentId)).toEqual([
      'custom:adventurer/mage-02',
      'custom:adventurer/mage-06',
      'custom:adventurer/mage-07',
      'custom:adventurer/tank-06',
      'custom:adventurer/tank-07',
      'custom:adventurer/support-09',
    ]);
    expect(customAdventurerCapabilityMatrix.filter(({ enabled }) => enabled)).toHaveLength(37);
    expect(customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'none').map(({ contentId }) => contentId)).toEqual([
      'custom:adventurer/tank-09',
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

  it('builds the expected eighty-six-card public adventurer supply', () => {
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
    expect(publicAdventurers).toHaveLength(86);
    expect(state.players.every(({ party }) => party.every(({ adventurerId }) => state.cards[adventurerId]!.definitionId.startsWith('custom:starter/')))).toBe(true);
  });
});
