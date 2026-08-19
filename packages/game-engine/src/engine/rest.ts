import type { DomainEvent, EngineError, GameState, PlayerState } from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { evaluateRestHandSize } from '../rules/rest-hand-size-evaluator.js';
import { attachTargets } from './target-supply.js';
import { drawCards } from './draw.js';
import { refillConfiguredSupplyRows } from './supply.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId: string): void {
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, causedByCommandId: commandId });
}

/** Completes rest as one command transaction after fixing the authoritative hand-size policy. */
export function finishRest(state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string): EngineError | undefined {
  const handSize = evaluateRestHandSize(state, ruleset, { schemaVersion: 1, playerId: player.id });
  if (handSize.status !== 'ready') return { code: 'INVALID_COMMAND', message: handSize.error };
  player.discardPile.push(...player.hand, ...player.playArea);
  player.hand = [];
  player.playArea = [];
  player.turnPurchaseBonus = 0;
  player.turnPurchaseSpent = 0;
  player.turnCombatBonus = 0;
  try {
    refillConfiguredSupplyRows(state, ruleset, events);
    attachTargets(state, ruleset);
    drawCards(state, player.id, handSize.evaluation.effectiveHandSize, events);
  } catch (error) {
    return { code: 'INVALID_COMMAND', message: error instanceof Error ? error.message : 'Rest settlement failed.' };
  }
  event(state, events, 'REST_FINISHED', `${player.name} 完成休息。`, commandId);
  if (state.status === 'finalRound' && state.endState?.finalRoundEndPlayerId === player.id) {
    state.status = 'finished';
    event(state, events, 'GAME_FINISHED', '目前輪次已完成，遊戲結束。', commandId);
    return undefined;
  }
  const currentIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const next = state.players[(currentIndex + 1) % state.players.length]!;
  state.activePlayerId = next.id;
  state.phase = 'action1';
  if (next.id === state.startingPlayerId) state.round += 1;
  return undefined;
}
