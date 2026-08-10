import type { CardPresenceActivation, ContentRegistry, GameState } from '@guildmaster/game-protocol';

export function matchesCardPresence(state: GameState, activation: CardPresenceActivation): boolean {
  const zone = state.zones[activation.zoneId];
  return Boolean(zone && zone.visibility === 'public' && zone.cardIds.some((cardId) => state.cards[cardId]?.definitionId === activation.definitionId));
}

export function validateCardPresenceState(state: GameState, registry: ContentRegistry, activation: CardPresenceActivation): string | undefined {
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
