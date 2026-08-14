import type { DomainEvent, EngineError, GameState, PlayerState } from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateRestHandSize } from '../rules/rest-hand-size-evaluator.js';
import { drawCards } from './draw.js';
import { attachTargets } from './create-game.js';
import { refillConfiguredSupplyRows } from './supply.js';

export function settleRest(state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string): EngineError | undefined {
  const handSize = evaluateRestHandSize(state, ruleset, { schemaVersion: 1, playerId: player.id });
  if (handSize.status !== 'ready') return { code: 'INVALID_COMMAND', message: handSize.error };
  player.discardPile.push(...player.hand, ...player.playArea); player.hand = []; player.playArea = [];
  player.turnPurchaseBonus = 0; player.turnPurchaseSpent = 0; player.turnCombatBonus = 0; player.turnMarketRefreshed = false;
  try {
    refillConfiguredSupplyRows(state, ruleset, events); attachTargets(state); drawCards(state, player.id, handSize.evaluation.effectiveHandSize, events);
  } catch (error) {
    return { code: 'INVALID_COMMAND', message: error instanceof Error ? error.message : 'Rest settlement failed.' };
  }
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'REST_FINISHED', message: `${player.name} 完成休息。`, causedByCommandId: commandId });
  return undefined;
}
