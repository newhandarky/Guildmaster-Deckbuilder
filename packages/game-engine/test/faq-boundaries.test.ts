import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@guildmaster/game-protocol';
import { dispatch, envelope } from '../src/index.js';
import { refillSupply } from '../src/engine/supply.js';
import { getPlayer } from '../src/model/factories.js';
import { makeGame, testRuleset } from './fixtures.js';
import { baseZoneIds } from '../src/model/zones.js';

describe('FAQ 與供應牌庫邊界', () => {
  it('道具使用後留在使用區，休息時才進棄牌堆', () => {
    const state = makeGame();
    const player = getPlayer(state, 'p1');
    const itemId = state.zones[baseZoneIds.itemRow]!.cardIds.find((id) => testRuleset.registry.definitions[state.cards[id]!.definitionId]!.type === 'item')!;
    state.zones[baseZoneIds.itemRow]!.cardIds = state.zones[baseZoneIds.itemRow]!.cardIds.filter((id) => id !== itemId);
    player.hand.push(itemId);
    const used = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }));
    expect(used.state.players[0]!.playArea).toContain(itemId);
    const toCombat = dispatch(used.state, testRuleset, envelope(used.state, 'p1', { type: 'END_PHASE', phase: 'action1' }));
    const toAction2 = dispatch(toCombat.state, testRuleset, envelope(toCombat.state, 'p1', { type: 'END_PHASE', phase: 'combat' }));
    const toPurchase = dispatch(toAction2.state, testRuleset, envelope(toAction2.state, 'p1', { type: 'END_PHASE', phase: 'action2' }));
    const toRest = dispatch(toPurchase.state, testRuleset, envelope(toPurchase.state, 'p1', { type: 'END_PHASE', phase: 'purchase' }));
    const rested = dispatch(toRest.state, testRuleset, envelope(toRest.state, 'p1', { type: 'END_PHASE', phase: 'rest' }));
    const restedPlayer = rested.state.players[0]!;
    expect(restedPlayer.playArea).not.toContain(itemId);
    expect([...restedPlayer.drawPile, ...restedPlayer.hand, ...restedPlayer.discardPile]).toContain(itemId);
  });

  it('公共供應牌庫耗盡會發出正式事件並暫停待官方確認', () => {
    const state = makeGame();
    state.zones[baseZoneIds.monsterRow]!.cardIds = [];
    state.zones[baseZoneIds.monsterDeck]!.cardIds = [state.zones[baseZoneIds.monsterDeck]!.cardIds[0]!];
    const events: DomainEvent[] = [];
    refillSupply(state, testRuleset, 'monster', events);
    expect(events.some((event) => event.type === 'SUPPLY_DECK_DEPLETED')).toBe(true);
    expect(state.status).toBe('pendingOfficialRuling');
  });
});
