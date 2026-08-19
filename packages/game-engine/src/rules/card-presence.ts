import type { CardPresenceActivation, ContentRegistry, GameState } from '@guildmaster/game-protocol';

export function matchesCardPresence(state: GameState, activation: CardPresenceActivation, evaluatedPlayerId?: string): boolean {
  if (activation.kind === 'definition-in-zone') {
    const zone = state.zones[activation.zoneId];
    return Boolean(zone && zone.visibility === 'public' && zone.cardIds.some((cardId) => state.cards[cardId]?.definitionId === activation.definitionId));
  }
  const playerId = activation.player === 'active-player' ? state.activePlayerId : evaluatedPlayerId;
  const player = state.players.find(({ id }) => id === playerId);
  return Boolean(player?.party.some(({ adventurerId }) => state.cards[adventurerId]?.definitionId === activation.definitionId));
}

export function validateCardPresenceState(state: GameState, registry: ContentRegistry, activation: CardPresenceActivation): string | undefined {
  if (!registry.definitions[activation.definitionId]) return `Activation references unknown definition ${activation.definitionId}.`;
  if (activation.kind === 'definition-in-player-party') {
    for (const player of state.players) for (const { adventurerId } of player.party) {
      const card = state.cards[adventurerId];
      if (!card) return `Player party references unknown card ${adventurerId}.`;
      if (!registry.definitions[card.definitionId]) return `Player party references unknown definition ${card.definitionId}.`;
    }
    return undefined;
  }
  const zone = state.zones[activation.zoneId];
  if (!zone) return `Activation zone ${activation.zoneId} is missing.`;
  if (zone.visibility !== 'public') return `Activation zone ${activation.zoneId} is not public.`;
  for (const cardId of zone.cardIds) {
    const card = state.cards[cardId];
    if (!card) return `Activation zone ${activation.zoneId} references unknown card ${cardId}.`;
    if (!registry.definitions[card.definitionId]) return `Activation zone ${activation.zoneId} references unknown definition ${card.definitionId}.`;
  }
  return undefined;
}
