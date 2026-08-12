import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, getLegalCommands, projectPlayerView, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import { baseZoneIds } from '../src/model/zones.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, kind: index === 0 ? 'human' as const : 'ai' as const }));
const setupPack: ContentPack = {
  ...testPack,
  manifest: { ...testPack.manifest, id: 'test:bond-setup', hash: 'bond-setup' },
  definitions: [...testPack.definitions,
    { id: 'test:boss/e', name: 'E', type: 'boss', copies: 1, combat: 4, source: 'test' },
    { id: 'test:boss/f', name: 'F', type: 'boss', copies: 1, combat: 4, source: 'test' }],
  bonds: Array.from({ length: 30 }, (_, index) => ({ id: `test:bond/${String(index + 1).padStart(2, '0')}`, name: `Bond ${index + 1}`, honor: (index % 5) + 1, requiredBosses: 99 })),
};

describe('four-player setup and market refresh commands', () => {
  it('deals seven private bonds and accepts exactly five from each authoritative offer', () => {
    const ruleset = createRuleset([setupPack], [baseRulesModule]);
    let state = createGame({ gameId: 'bond-setup', seed: 17, players, startingPlayerId: 'p1' }, ruleset);
    expect(state.status).toBe('setup');
    expect(Object.values(state.bondSetup!.offers).flat()).toHaveLength(28);
    expect(new Set(Object.values(state.bondSetup!.offers).flat()).size).toBe(28);
    expect(getLegalCommands(state, ruleset, 'p1')).toHaveLength(21);
    expect(getLegalCommands(state, ruleset, 'p2')).toEqual([]);
    expect(projectPlayerView(state, ruleset, 'p1').bondSetup?.offeredBondIds).toHaveLength(7);
    expect(projectPlayerView(state, ruleset, 'p2').bondSetup?.offeredBondIds).toBeUndefined();

    for (const player of players) {
      const legal = getLegalCommands(state, ruleset, player.id);
      expect(legal[0]?.type).toBe('SELECT_BONDS');
      const result = dispatch(state, ruleset, envelope(state, player.id, legal[0]!));
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    expect(state.status).toBe('playing');
    expect(state.bondSetup).toBeUndefined();
    expect(state.activePlayerId).toBe('p1');
    expect(state.players.every(({ bonds }) => bonds.length === 5)).toBe(true);
  });

  it('round-trips setup and rejects an offer that diverges from canonical seed replay', () => {
    const ruleset = createRuleset([setupPack], [baseRulesModule]);
    const state = createGame({ gameId: 'bond-snapshot', seed: 23, players }, ruleset);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
    const tampered = structuredClone(serializeSnapshot(state));
    [tampered.state.bondSetup!.offers.p1![0], tampered.state.bondSetup!.offers.p2![0]] = [tampered.state.bondSetup!.offers.p2![0]!, tampered.state.bondSetup!.offers.p1![0]!];
    expect(() => restoreSnapshot(tampered, ruleset)).toThrow(/canonical seed replay/);
  });

  it('refreshes one public market row atomically and only once per turn', () => {
    const state = makeGame();
    state.phase = 'purchase';
    const player = state.players[0]!;
    const discardCardId = player.hand[0]!;
    const refreshCardIds = state.zones[baseZoneIds.itemRow]!.cardIds.slice(0, 2);
    const beforeRng = state.rngState;
    const command = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId, refreshCardIds };
    expect(getLegalCommands(state, testRuleset, player.id)).toContainEqual(command);
    const result = dispatch(state, testRuleset, envelope(state, player.id, command));
    expect(result.error).toBeUndefined();
    expect(result.state.rngState).not.toBe(beforeRng);
    expect(result.state.players[0]!.discardPile).toContain(discardCardId);
    expect(result.state.players[0]!.turnMarketRefreshed).toBe(true);
    expect(result.state.turnFacts).toMatchObject({ playerId: 'p1', marketRefreshed: true });
    expect(result.state.zones[baseZoneIds.itemRow]!.cardIds).toHaveLength(3);
    expect(getLegalCommands(result.state, testRuleset, player.id).some(({ type }) => type === 'REFRESH_MARKET')).toBe(false);
  });

  it('rolls back a stale market subset without consuming RNG or cards', () => {
    const state = makeGame();
    state.phase = 'purchase';
    const before = structuredClone(state);
    const result = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'REFRESH_MARKET', row: 'item', discardCardId: state.players[0]!.hand[0]!, refreshCardIds: ['not-in-row'] }));
    expect(result.error?.code).toBe('INVALID_COMMAND');
    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
  });
});
