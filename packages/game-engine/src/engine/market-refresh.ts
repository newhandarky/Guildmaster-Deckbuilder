import type { DomainEvent, GameState, PlayerState } from '@guildmaster/game-protocol';
import { baseZoneIds, getZone } from '../model/zones.js';
import { shuffle } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { pushDiscard } from '../rules/discard-redirect-evaluator.js';
import { refillSupply } from './supply.js';

export function applyMarketRefresh(state: GameState, ruleset: Ruleset, player: PlayerState, command: { row: 'adventurer' | 'item'; discardCardId: string; refreshCardIds: readonly string[] }, events: DomainEvent[], commandId: string): string | undefined {
  if (state.phase !== 'purchase') return '目前不是購買階段。';
  if (player.turnMarketRefreshed) return '本回合已使用市場刷新。';
  if (!player.hand.includes(command.discardCardId)) return '市場刷新必須棄置目前手牌。';
  if (!command.refreshCardIds.length || command.refreshCardIds.length > 3 || new Set(command.refreshCardIds).size !== command.refreshCardIds.length) return '市場刷新卡牌集合無效。';
  const rowZoneId = command.row === 'adventurer' ? baseZoneIds.adventurerRow : baseZoneIds.itemRow;
  const deckZoneId = command.row === 'adventurer' ? baseZoneIds.adventurerDeck : baseZoneIds.itemDeck;
  const row = getZone(state, rowZoneId);
  if (command.refreshCardIds.some((cardId) => !row.cardIds.includes(cardId))) return '市場刷新只能選擇指定公開列中的卡牌。';
  player.hand.splice(player.hand.indexOf(command.discardCardId), 1); pushDiscard(state, ruleset, player.id, command.discardCardId);
  for (const cardId of command.refreshCardIds) row.cardIds.splice(row.cardIds.indexOf(cardId), 1);
  const deck = getZone(state, deckZoneId); deck.cardIds = shuffle(state, [...deck.cardIds, ...command.refreshCardIds]); refillSupply(state, ruleset, command.row, events);
  player.turnMarketRefreshed = true;
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'MARKET_REFRESHED', message: `${player.name} 刷新了 ${command.row} 公開列。`, causedByCommandId: commandId });
  return undefined;
}
