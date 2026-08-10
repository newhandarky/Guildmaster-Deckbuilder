import { describe, expect, it } from 'vitest';
import { baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createGame, createRuleset } from '@guildmaster/game-engine';
import {
  baseHelperIds,
  baseHelpersRulesModule,
  baseHelperZoneIds,
  baseProvisionalHelpersContentPack,
  enabledBaseHelperDefinitionId,
} from '../src/index.js';

describe('provisional helper content extension', () => {
  it('publishes twelve neutral helper definitions with only helper 08 enabled', () => {
    expect(baseProvisionalHelpersContentPack.manifest).toMatchObject({
      id: 'base:provisional-helpers',
      role: 'expansion',
      contentStatus: 'provisional-playtest',
      dependencies: [baseProvisionalFoundationContentPack.manifest.id],
    });
    expect(baseProvisionalHelpersContentPack.definitions.map(({ id }) => id)).toEqual(baseHelperIds);
    expect(baseProvisionalHelpersContentPack.definitions).toHaveLength(12);
    expect(baseProvisionalHelpersContentPack.definitions.every(({ name, type, copies, tags }) =>
      /^候選協助者 \d{2}$/.test(name) && type === 'helper' && copies === 1 && tags?.includes('playtest:helper'))).toBe(true);
    expect(baseProvisionalHelpersContentPack.definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled')))
      .toEqual([expect.objectContaining({ id: enabledBaseHelperDefinitionId })]);
    expect(baseProvisionalHelpersContentPack.definitions.filter(({ id }) => id !== enabledBaseHelperDefinitionId)
      .every(({ tags }) => tags?.includes('playtest:effects-disabled'))).toBe(true);
  });

  it('composes with the unchanged foundation and creates one hidden helper per selected boss', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    const state = createGame({ gameId: 'base-helper-content', seed: 97, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    expect(state.moduleState['base:helpers']).toEqual({ schemaVersion: 1 });
    expect(state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(1);
    expect(state.zones[baseHelperZoneIds.deck]!.cardIds).toHaveLength(3);
    expect(state.zones[baseHelperZoneIds.retired]!.cardIds).toEqual([]);
    expect(baseProvisionalFoundationContentPack.definitions).toHaveLength(34);
  });
});
