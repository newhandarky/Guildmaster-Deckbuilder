import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, getLegalCommands, getScoreboard, nextSeat, previousSeat, projectPlayerView, seatOrderFrom } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { baseZoneIds } from '../src/model/zones.js';
import { testPack } from './fixtures.js';

const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, kind: index === 0 ? 'human' as const : 'ai' as const }));
const fourPlayerPack: ContentPack = {
  ...testPack,
  manifest: { ...testPack.manifest, id: 'test:four-player-content', hash: 'four-player-content' },
  definitions: [...testPack.definitions,
    { id: 'test:boss/e', name: '魔王 E', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' },
    { id: 'test:boss/f', name: '魔王 F', type: 'boss', copies: 1, combat: 4, honor: 2, source: 'mvp-demo' }],
};

describe('four-player base authority', () => {
  it('uses stable circular seat helpers', () => {
    expect(nextSeat(players, 'p4').id).toBe('p1');
    expect(previousSeat(players, 'p1').id).toBe('p4');
    expect(seatOrderFrom(players, 'p3').map(({ id }) => id)).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect(() => nextSeat(players, 'missing')).toThrow(/Unknown seat player/);
  });

  it('requires enough bosses and rejects more than four players', () => {
    expect(() => createGame({ gameId: 'short', seed: 3, players }, createRuleset([testPack], [baseRulesModule]))).toThrow(/requires 6 boss definitions; found 4/);
    expect(() => createGame({ gameId: 'too-many', seed: 3, players: [...players, { id: 'p5', name: 'P5', kind: 'ai' }] }, createRuleset([fourPlayerPack], [baseRulesModule]))).toThrow(/two to four players/);
  });

  it('projects public rows without exposing any base ordered deck', () => {
    const ruleset = createRuleset([fourPlayerPack], [baseRulesModule]);
    const state = createGame({ gameId: 'hidden', seed: 7, players }, ruleset);
    const view = projectPlayerView(state, ruleset, 'p1');
    for (const zoneId of [baseZoneIds.adventurerDeck, baseZoneIds.itemDeck, baseZoneIds.monsterDeck, baseZoneIds.bossDeck]) {
      expect(view.zones[zoneId]).toBeUndefined();
      expect(state.zones[zoneId]!.cardIds.length).toBeGreaterThan(0);
    }
    expect(view.zones[baseZoneIds.adventurerRow]!.cardIds).toHaveLength(3);
  });

  it('allows a configured starter adventurer, but not a starter resource, to rejoin the party', () => {
    const ruleset = createRuleset([fourPlayerPack], [baseRulesModule]);
    const state = createGame({ gameId: 'starter-rejoin', seed: 8, players }, ruleset);
    const starter = state.players[0]!.party.shift()!.adventurerId;
    state.players[0]!.hand.push(starter);
    const legal = getLegalCommands(state, ruleset, 'p1');
    expect(legal).toContainEqual({ type: 'PLAY_ADVENTURER', cardId: starter });
    expect(legal).not.toContainEqual({ type: 'PLAY_ADVENTURER', cardId: state.players[0]!.hand.find((id) => state.cards[id]?.definitionId === 'test:starter/stone') });
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'PLAY_ADVENTURER', cardId: starter }));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.party.at(-1)?.adventurerId).toBe(starter);
  });

  it('ends the final round at the seat immediately before the starting player', () => {
    const finishModule: RulesModule = { id: 'test:finish-after-attack', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', endConditions: [{ id: 'test:finish', evaluate: () => true }] };
    const ruleset = createRuleset([fourPlayerPack], [baseRulesModule, finishModule]);
    const state = createGame({ gameId: 'final-round', seed: 9, players, startingPlayerId: 'p1' }, ruleset);
    state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined();
    expect(result.state.status).toBe('finalRound');
    expect(result.state.endState?.finalRoundEndPlayerId).toBe('p4');
  });

  it('records both simultaneous final-round reasons while triggering only one final round', () => {
    const pack = structuredClone(fourPlayerPack);
    pack.manifest = { ...pack.manifest, id: 'test:four-player-dual-end', hash: 'dual-end' };
    pack.bonds = [{ id: 'test:bond/a', name: 'Ready', honor: 1, requiredBosses: 0 }];
    const ruleset = createRuleset([pack], [baseRulesModule]);
    const state = createGame({ gameId: 'dual-end', seed: 10, players, startingPlayerId: 'p1' }, ruleset);
    state.removedCards.push(...state.zones[baseZoneIds.bossDeck]!.cardIds.splice(0), ...state.zones[baseZoneIds.bossRow]!.cardIds.splice(0));
    for (const target of Object.values(state.enemyTargets).filter(({ kind }) => kind === 'boss')) target.status = 'defeated';
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'COMPLETE_BONDS', bondIds: ['test:bond/a'] }));
    expect(result.error).toBeUndefined();
    expect(result.state.status).toBe('finalRound');
    expect(result.state.endState?.conditionIds).toEqual(['base:all-bosses-defeated', 'base:all-bonds-completed']);
    expect(result.events.filter(({ type }) => type === 'FINAL_ROUND_TRIGGERED')).toHaveLength(1);
  });

  it('assigns shared competition ranks', () => {
    const ruleset = createRuleset([fourPlayerPack], [baseRulesModule]);
    const state = createGame({ gameId: 'rank', seed: 11, players }, ruleset);
    state.players[0]!.history.defeatedBosses = 2;
    state.players[1]!.history.defeatedBosses = 2;
    state.players[2]!.history.defeatedBosses = 1;
    const rows = getScoreboard(state, ruleset);
    expect(rows.slice(0, 3).map(({ rank }) => rank)).toEqual([1, 1, 3]);
    expect(rows.filter(({ rank }) => rank === 1).map(({ playerId }) => playerId).sort()).toEqual(['p1', 'p2']);
  });
});
