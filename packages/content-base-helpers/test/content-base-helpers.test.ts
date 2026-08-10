import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import {
  baseRulesModule,
  createGame,
  createRuleset,
  dispatch,
  envelope,
  getPartyLimit,
} from '@guildmaster/game-engine';
import {
  baseHelperIds,
  baseHelpersRulesModule,
  baseHelperZoneIds,
  baseProvisionalHelpersContentPack,
  enabledBaseHelperDefinitionId,
} from '../src/index.js';

describe('provisional helper content extension', () => {
  it('publishes twelve neutral helper definitions with only helper 08 enabled', () => {
    expect(baseProvisionalContentCatalog.candidates
      .filter(({ category }) => category === 'helper')
      .map(({ definitionId }) => definitionId)).toEqual(baseHelperIds);
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

  it('runs equipment triggers before helper rotation and capacity enforcement', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    let state: ReturnType<typeof createGame> | undefined;
    for (let seed = 1; seed <= 256; seed += 1) {
      const candidate = createGame({
        gameId: `base-helper-order-${seed}`,
        seed,
        players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
        startingPlayerId: 'p1',
      }, ruleset);
      const selected = [
        ...candidate.zones[baseHelperZoneIds.active]!.cardIds,
        ...candidate.zones[baseHelperZoneIds.deck]!.cardIds,
      ];
      if (selected.some((cardId) => candidate.cards[cardId]!.definitionId === enabledBaseHelperDefinitionId)) {
        state = candidate;
        break;
      }
    }
    if (!state) throw new Error('A deterministic seed must select helper 08 within the test budget.');

    const active = state.zones[baseHelperZoneIds.active]!.cardIds;
    const helperDeck = state.zones[baseHelperZoneIds.deck]!.cardIds;
    const helper08 = [...active, ...helperDeck]
      .find((cardId) => state!.cards[cardId]!.definitionId === enabledBaseHelperDefinitionId)!;
    if (active[0] !== helper08) {
      const current = active[0]!;
      helperDeck.splice(helperDeck.indexOf(helper08), 1, current);
      active[0] = helper08;
    }
    const nextDisabled = helperDeck
      .findIndex((cardId) => state!.cards[cardId]!.definitionId !== enabledBaseHelperDefinitionId);
    helperDeck.push(...helperDeck.splice(nextDisabled, 1));

    const player = state.players[0]!;
    while (player.party.length < 6) {
      player.party.push({ adventurerId: state.zones['base:adventurer-deck']!.cardIds.pop()! });
    }
    const equipmentDefinitionId = 'base:resource/resource-18';
    const equipmentZone = ['base:item-row', 'base:item-deck']
      .map((zoneId) => state!.zones[zoneId]!)
      .find((zone) => zone.cardIds.some((cardId) => state!.cards[cardId]!.definitionId === equipmentDefinitionId));
    if (!equipmentZone) throw new Error('The foundation setup must contain resource 18.');
    const equipmentIndex = equipmentZone.cardIds
      .findIndex((cardId) => state!.cards[cardId]!.definitionId === equipmentDefinitionId);
    const [equipmentId] = equipmentZone.cardIds.splice(equipmentIndex, 1);
    if (!equipmentId) throw new Error('The resource 18 instance must be available.');
    const discardedMemberId = player.party.at(-1)!.adventurerId;
    player.party.at(-1)!.equipmentId = equipmentId;
    player.turnCombatBonus = 99;
    state.phase = 'combat';
    expect(getPartyLimit(ruleset, state, player)).toBe(6);

    const boss = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const result = dispatch(state, ruleset, envelope(
      state,
      'p1',
      { type: 'ATTACK_TARGET', targetId: boss.targetId },
      'base-helper-ordering',
    ));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.discardPile.slice(-2)).toEqual([discardedMemberId, equipmentId]);
    expect(getPartyLimit(ruleset, result.state, result.state.players[0]!)).toBe(5);
    const eventTypes = result.events.map(({ type }) => type);
    expect(eventTypes.indexOf('CARD_DRAWN')).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf('CARD_DRAWN')).toBeLessThan(eventTypes.indexOf('SUPPLY_ROW_REFRESHED'));
    expect(eventTypes.indexOf('SUPPLY_ROW_REFRESHED')).toBeLessThan(eventTypes.indexOf('PARTY_MEMBER_DISCARDED'));

  });

  it('refills each defeated boss and rotates helpers through the final boss', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    let state = createGame({
      gameId: 'base-helper-all-bosses',
      seed: 131,
      players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
      startingPlayerId: 'p1',
    }, ruleset);
    const selectedCount = state.zones[baseHelperZoneIds.deck]!.cardIds.length
      + state.zones[baseHelperZoneIds.active]!.cardIds.length;
    for (let index = 0; index < selectedCount; index += 1) {
      state.players[0]!.turnCombatBonus = 99;
      state.phase = 'combat';
      const boss = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available');
      if (!boss) throw new Error(`Boss ${index + 1} must be available after refill.`);
      const result = dispatch(state, ruleset, envelope(
        state,
        'p1',
        { type: 'ATTACK_TARGET', targetId: boss.targetId },
        `base-helper-boss-${index + 1}`,
      ));
      expect(result.error).toBeUndefined();
      state = result.state;
      expect(state.zones[baseHelperZoneIds.retired]!.cardIds).toHaveLength(index + 1);
      expect(state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(index + 1 < selectedCount ? 1 : 0);
      expect(state.zones['base:boss-row']!.cardIds).toHaveLength(index + 1 < selectedCount ? 1 : 0);
    }
    expect(state.players[0]!.history.defeatedBosses).toBe(selectedCount);
    expect(state.zones['base:boss-deck']!.cardIds).toEqual([]);
  });
});
