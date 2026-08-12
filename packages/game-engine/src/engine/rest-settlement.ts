import type { DomainEvent, GameState, PlayerState } from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { drawCards } from './draw.js';
import { attachTargets } from './create-game.js';
import { refillConfiguredSupplyRows } from './supply.js';

export function settleRest(state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string): void {
  player.discardPile.push(...player.hand, ...player.playArea); player.hand = []; player.playArea = [];
  player.turnPurchaseBonus = 0; player.turnPurchaseSpent = 0; player.turnCombatBonus = 0; player.turnMarketRefreshed = false;
  refillConfiguredSupplyRows(state, ruleset, events); attachTargets(state); drawCards(state, player.id, 5, events);
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'REST_FINISHED', message: `${player.name} 完成休息。`, causedByCommandId: commandId });
}
