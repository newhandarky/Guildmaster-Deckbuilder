import type { CardDefinition, CardInstance, ContentRegistry, GameState, PlayerState } from '@guildmaster/game-protocol';

export function getDefinition(registry: ContentRegistry, state: GameState, cardId: string): CardDefinition {
  const instance = state.cards[cardId];
  if (!instance) throw new Error(`Unknown card instance: ${cardId}`);
  const definition = registry.definitions[instance.definitionId];
  if (!definition) throw new Error(`Unknown card definition: ${instance.definitionId}`);
  return definition;
}

export function createCard(state: GameState, definitionId: string, ownerId?: string): CardInstance {
  const id = `card-${Object.keys(state.cards).length + 1}`;
  const card: CardInstance = ownerId ? { id, definitionId, ownerId } : { id, definitionId };
  state.cards[id] = card;
  return card;
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return player;
}
