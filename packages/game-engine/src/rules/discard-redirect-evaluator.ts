import type { GameState, PlayerState } from '@guildmaster/game-protocol';
import { previousSeat } from '../model/seats.js';
import type { Ruleset } from './ruleset.js';

export function discardDestination(state: GameState, ruleset: Ruleset, holderId: string, cardId: string): PlayerState {
  const holder = state.players.find(({ id }) => id === holderId);
  const card = state.cards[cardId];
  if (!holder || !card) throw new Error('Discard redirect requires a known holder and card.');
  const matching = ruleset.modules.flatMap((module) => module.discardRedirectPolicies ?? [])
    .filter(({ definitionIds }) => definitionIds.includes(card.definitionId))
    .sort((left, right) => left.priority - right.priority);
  if (matching.some((policy, index) => index > 0 && policy.priority === matching[index - 1]!.priority)) throw new Error('Discard redirect policies require distinct priorities.');
  return matching.at(-1)?.destination === 'right-seat-discard' ? previousSeat(state.players, holderId) : holder;
}

export function pushDiscard(state: GameState, ruleset: Ruleset, holderId: string, cardId: string): PlayerState {
  const destination = discardDestination(state, ruleset, holderId, cardId);
  destination.discardPile.push(cardId); state.cards[cardId]!.ownerId = destination.id;
  return destination;
}
