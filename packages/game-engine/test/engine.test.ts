import { describe, expect, it } from 'vitest';
import { dispatch, envelope, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { getPlayer } from '../src/model/factories.js';
import { makeGame, testRuleset } from './fixtures.js';
import { baseZoneIds } from '../src/model/zones.js';

describe('基礎規則引擎', () => {
  it('隊伍滿員時加入冒險者會擠出最左側成員', () => {
    const state = makeGame();
    const player = getPlayer(state, 'p1');
    const cardId = state.zones[baseZoneIds.adventurerRow]!.cardIds[0]!;
    state.zones[baseZoneIds.adventurerRow]!.cardIds.splice(0, 1);
    player.hand.push(cardId);
    const displaced = player.party[0]!.adventurerId;
    const result = dispatch(state, testRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId }));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.party).toHaveLength(5);
    expect(result.state.players[0]!.discardPile).toContain(displaced);
  });

  it('討伐只派遣達標所需的最小前綴', () => {
    const state = makeGame();
    state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find((target) => target.kind === 'monster')!.targetId;
    const result = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.party).toHaveLength(2);
    expect(result.state.players[0]!.history.defeatedMonsters).toBe(1);
  });

  it('Snapshot JSON round-trip 保留可序列化狀態', () => {
    const state = makeGame();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))));
    expect(restored).toEqual(state);
  });
});
