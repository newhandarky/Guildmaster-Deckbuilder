import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@guildmaster/game-protocol';
import { drawCards, revealTopCards } from '../src/engine/draw.js';
import { getPlayer } from '../src/model/factories.js';
import { makeGame } from './fixtures.js';

describe('個人牌庫抽牌規則', () => {
  it('只在抽牌途中牌庫空且仍需抽時洗棄牌堆', () => {
    const state = makeGame();
    const player = getPlayer(state, 'p1');
    player.hand = [];
    player.drawPile = [player.party[0]!.adventurerId];
    player.discardPile = [player.party[1]!.adventurerId];
    const events: DomainEvent[] = [];
    drawCards(state, player.id, 2, events);
    expect(player.hand).toHaveLength(2);
    expect(events.some((item) => item.type === 'DRAW_PILE_REBUILT')).toBe(true);
  });

  it('抽完最後一張而不需續抽時不洗棄牌堆', () => {
    const state = makeGame();
    const player = getPlayer(state, 'p1');
    player.hand = [];
    player.drawPile = [player.party[0]!.adventurerId];
    player.discardPile = [player.party[1]!.adventurerId];
    const events: DomainEvent[] = [];
    drawCards(state, player.id, 1, events);
    expect(player.discardPile).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('展示牌庫頂不洗牌', () => {
    const state = makeGame();
    const player = getPlayer(state, 'p1');
    player.drawPile = [];
    player.discardPile = [player.party[0]!.adventurerId];
    expect(revealTopCards(state, player.id, 2)).toEqual([]);
    expect(player.discardPile).toHaveLength(1);
  });
});
