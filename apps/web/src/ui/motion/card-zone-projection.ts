import type { DomainEvent, PlayerView } from '@guildmaster/game-protocol';
import type { CardZoneTransition, PublicCardProjection } from './types.js';

/** Projects only identities already visible to this PlayerView. */
export function projectPublicCardZones(view: PlayerView): PublicCardProjection {
  const projection = new Map<string, string>();
  const add = (ids: readonly string[], zone: string) => {
    for (const id of ids) if (view.cards[id]) projection.set(id, zone);
  };
  add(view.self.hand, 'self:hand');
  add(view.self.discardPile, 'self:discard');
  add(view.self.playArea, 'self:play');
  for (const slot of view.self.party) {
    add([slot.adventurerId], 'self:party');
    add(slot.equipmentIds ?? (slot.equipmentId ? [slot.equipmentId] : []), `self:equipment:${slot.adventurerId}`);
  }
  for (const opponent of view.opponents) {
    for (const slot of opponent.party) {
      add([slot.adventurerId], `opponent:${opponent.id}:party`);
      add(slot.equipmentIds ?? (slot.equipmentId ? [slot.equipmentId] : []), `opponent:${opponent.id}:equipment:${slot.adventurerId}`);
    }
  }
  for (const [zoneId, zone] of Object.entries(view.zones)) add(zone.cardIds, zoneId);
  return projection;
}

export function diffPublicCardZones(before: PlayerView, after: PlayerView): CardZoneTransition[] {
  const previous = projectPublicCardZones(before);
  const next = projectPublicCardZones(after);
  const ids = new Set([...previous.keys(), ...next.keys()]);
  return [...ids].flatMap((cardId) => {
    const from = previous.get(cardId);
    const to = next.get(cardId);
    if (from === to) return [];
    return [{ cardId, ...(from ? { from } : {}), ...(to ? { to } : {}), kind: from && to ? 'move' : from ? 'leave' : 'enter' } satisfies CardZoneTransition];
  });
}

function payloadStrings(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') found.add(value);
  else if (Array.isArray(value)) for (const item of value) payloadStrings(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) payloadStrings(item, found);
}

/** Uses structured event payloads for sequencing, never human-readable event messages. */
export function orderTransitionsByCommittedEvents(
  transitions: readonly CardZoneTransition[],
  events: readonly DomainEvent[],
): CardZoneTransition[] {
  const firstEvent = new Map<string, number>();
  events.forEach((event, eventIndex) => {
    const values = new Set<string>();
    payloadStrings(event.payload, values);
    for (const transition of transitions) if (values.has(transition.cardId) && !firstEvent.has(transition.cardId)) firstEvent.set(transition.cardId, eventIndex);
  });
  return transitions.map((transition, index) => ({ transition, index }))
    .sort((left, right) => (firstEvent.get(left.transition.cardId) ?? Number.MAX_SAFE_INTEGER) - (firstEvent.get(right.transition.cardId) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ transition }) => transition);
}
