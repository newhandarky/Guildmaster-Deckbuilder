import type { DomainEvent, GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { shuffle } from '../ports/random.js';

export function drawCards(state: GameState, playerId: string, count: number, events: DomainEvent[]): void {
  const player = getPlayer(state, playerId);
  for (let remaining = count; remaining > 0; remaining -= 1) {
    const cardId = player.drawPile.pop();
    if (cardId) {
      player.hand.push(cardId);
      events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'CARD_DRAWN', message: `${player.name} 抽了一張牌。` });
      continue;
    }
    if (player.discardPile.length === 0) break;
    player.drawPile = shuffle(state, player.discardPile);
    player.discardPile = [];
    events.push({ eventId: `event-${events.length + 1}`, revision: state.revision + 1, type: 'DRAW_PILE_REBUILT', message: `${player.name} 洗混棄牌堆重建牌庫。` });
    const rebuiltCardId = player.drawPile.pop();
    if (rebuiltCardId) player.hand.push(rebuiltCardId);
  }
}

export function revealTopCards(state: GameState, playerId: string, count: number): string[] {
  const player = getPlayer(state, playerId);
  return player.drawPile.slice(Math.max(0, player.drawPile.length - count)).reverse();
}
