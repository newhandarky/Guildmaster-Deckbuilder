import { describe, expect, it } from 'vitest';
import { eventDisplayMessage } from './event-copy.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LatestEventStatus } from './LatestEventStatus.js';

const event = (type: string, message: string) => ({ eventId: 'event-1', revision: 1, type, message });

describe('eventDisplayMessage', () => {
  it('preserves player-facing Traditional Chinese event copy', () => {
    expect(eventDisplayMessage(event('CARD_DRAWN', '你抽了一張牌。'))).toBe('你抽了一張牌。');
  });

  it('does not expose helper effect ids and explains the transfer result', () => {
    expect(eventDisplayMessage(event('EFFECT_STARTED', 'Effect base:helpers/helper-11-pass-card-at-turn-start started.'))).toContain('交給左側玩家');
    expect(eventDisplayMessage(event('EFFECT_COMPLETED', 'Effect choice base:helper/helper-11-pass-card completed.'))).toBe('已將所選手牌交給左側玩家。');
  });

  it('replaces generic engine English with player-facing status', () => {
    expect(eventDisplayMessage(event('CARD_MOVED', 'Effect moved a card.'))).toBe('卡牌已依效果文字移動到指定區域。');
  });

  it('preserves the destructive meaning of a private card removal without exposing its identity', () => {
    const copy = eventDisplayMessage(event('CARD_REMOVED', 'Player privately removed one inspected card from the game.'));
    expect(copy).toContain('移出遊戲');
    expect(copy).toContain('不是棄牌');
    expect(copy).not.toContain('Player');
  });

  it('uses the same safe copy in the always-visible latest event status', () => {
    const markup = renderToStaticMarkup(createElement(LatestEventStatus, { event: event('EFFECT_COMPLETED', 'Effect choice base:helper/helper-11-pass-card completed.') }));
    expect(markup).toContain('已將所選手牌交給左側玩家');
    expect(markup).not.toContain('base:');
  });
});
