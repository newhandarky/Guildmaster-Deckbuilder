import type { CombatParticipantDepartureEvaluation, DomainEvent, GameState, PlayerState } from '@guildmaster/game-protocol';
import { getZone } from '../model/zones.js';
import { shuffle } from '../ports/random.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId: string): void {
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, causedByCommandId: commandId });
}

/** Applies an already-authorized departure plan. Equipment remains a separate policy boundary. */
export function applyCombatParticipantDeparture(state: GameState, player: PlayerState, participantCardIds: readonly string[], evaluation: CombatParticipantDepartureEvaluation, events: DomainEvent[], commandId: string): void {
  const sharedDeckReturns = new Map<string, string[]>();
  for (const cardId of participantCardIds) {
    const destination = evaluation.participantDispositions.find((entry) => entry.cardId === cardId)?.destination;
    if (!destination || destination.kind === 'discard') player.discardPile.push(cardId);
    else if (destination.kind === 'remove-from-game') state.removedCards.push(cardId);
    else {
      const returned = sharedDeckReturns.get(destination.zoneId) ?? [];
      returned.push(cardId); sharedDeckReturns.set(destination.zoneId, returned);
      delete state.cards[cardId]!.ownerId;
    }
  }
  for (const [zoneId, returned] of sharedDeckReturns) {
    const zone = getZone(state, zoneId); zone.cardIds = shuffle(state, [...zone.cardIds, ...returned]);
    event(state, events, 'COMBAT_PARTICIPANTS_SHUFFLED', `${returned.length} 名參戰冒險者洗回公共牌庫。`, commandId);
  }
  if (evaluation.replacementDraw) {
    const source = getZone(state, evaluation.replacementDraw.sourceZoneId);
    for (let remaining = evaluation.replacementDraw.count; remaining > 0; remaining -= 1) {
      const cardId = source.cardIds.pop(); if (!cardId) break;
      player[evaluation.replacementDraw.destination].push(cardId); state.cards[cardId]!.ownerId = player.id;
      event(state, events, 'SHARED_DECK_CARD_DRAWN', `${player.name} 從公共牌庫取得一張替代冒險者。`, commandId);
    }
  }
  if (evaluation.appliedPolicy) event(state, events, 'COMBAT_PARTICIPANT_DEPARTURE_APPLIED', `套用參戰者離場規則 ${evaluation.appliedPolicy.moduleId}/${evaluation.appliedPolicy.policyId}（${evaluation.reasonCode}）。`, commandId);
}
