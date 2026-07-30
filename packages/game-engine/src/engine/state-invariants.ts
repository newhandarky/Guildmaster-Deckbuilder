import { isFiniteJsonValue, type GameState } from '@guildmaster/game-protocol';

const duplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => seen.has(value) || !seen.add(value));
};

/** Validates relationships that cannot be expressed by the Snapshot field schemas. */
export function validateGameStateInvariants(state: GameState): string[] {
  const errors: string[] = [];
  if (!isFiniteJsonValue(state)) return ['Game state must contain finite, acyclic, plain JSON data only.'];

  const playerIds = state.players.map(({ id }) => id);
  if (duplicates(playerIds).length) errors.push('Player IDs must be unique.');
  if (!playerIds.includes(state.activePlayerId)) errors.push('Active player must exist.');
  if (!playerIds.includes(state.startingPlayerId)) errors.push('Starting player must exist.');
  if (duplicates(state.rulesModules.map(({ id }) => id)).length) errors.push('Rules Module IDs must be unique.');
  if (duplicates(state.contentPacks.map(({ id }) => id)).length) errors.push('Content Pack IDs must be unique.');

  const locations = new Map<string, string[]>();
  const addLocation = (cardId: string, location: string): void => {
    if (!state.cards[cardId]) errors.push(`Unknown card ${cardId} at ${location}.`);
    const entries = locations.get(cardId) ?? [];
    entries.push(location);
    locations.set(cardId, entries);
  };

  for (const [cardId, card] of Object.entries(state.cards)) {
    if (card.id !== cardId) errors.push(`Card record key ${cardId} does not match card ID ${card.id}.`);
    if (card.ownerId && !playerIds.includes(card.ownerId)) errors.push(`Card ${cardId} has unknown owner ${card.ownerId}.`);
  }
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    if (zone.zoneId !== zoneId) errors.push(`Zone record key ${zoneId} does not match zone ID ${zone.zoneId}.`);
    if (duplicates(zone.cardIds).length) errors.push(`Zone ${zoneId} contains duplicate cards.`);
    if (zone.kind === 'singleSlot' && zone.cardIds.length > 1) errors.push(`Single-slot zone ${zoneId} contains more than one card.`);
    if (zone.ownerId && !playerIds.includes(zone.ownerId)) errors.push(`Zone ${zoneId} has unknown owner ${zone.ownerId}.`);
    for (const cardId of zone.cardIds) addLocation(cardId, `zone:${zoneId}`);
  }
  for (const player of state.players) {
    if (duplicates(player.counters.map(({ resourceId }) => resourceId)).length) errors.push(`Player ${player.id} counters must have unique resource IDs.`);
    for (const zoneName of ['drawPile', 'hand', 'discardPile', 'playArea'] as const) {
      if (duplicates(player[zoneName]).length) errors.push(`Player ${player.id} ${zoneName} contains duplicate cards.`);
      for (const cardId of player[zoneName]) addLocation(cardId, `player:${player.id}:${zoneName}`);
    }
    player.party.forEach((slot, index) => {
      addLocation(slot.adventurerId, `player:${player.id}:party:${index}`);
      if (slot.equipmentId) addLocation(slot.equipmentId, `player:${player.id}:equipment:${index}`);
    });
  }
  const consent = state.effectState.pendingCounterConsent;
  if (consent) {
    if (state.effectState.pendingChoice) errors.push('Counter consent and effect choice cannot be pending together.');
    if (!playerIds.includes(consent.counterOwnerId) || consent.requesterId !== consent.counterOwnerId || consent.context.controllerId !== consent.requesterId) errors.push('Pending counter consent has an invalid owner, requester, or context.');
    if (duplicates(consent.requiredActorIds).length || duplicates(consent.acceptedActorIds).length || consent.requiredActorIds.includes(consent.requesterId) || consent.acceptedActorIds.some((id) => !consent.requiredActorIds.includes(id)) || consent.requiredActorIds.some((id) => !playerIds.includes(id))) errors.push('Pending counter consent responder sets are invalid.');
  }
  if (duplicates(state.removedCards).length) errors.push('Removed cards contains duplicate IDs.');
  for (const cardId of state.removedCards) addLocation(cardId, 'removed');

  const encounterIds = state.enemyEncounters.map(({ encounterId }) => encounterId);
  if (duplicates(encounterIds).length) errors.push('Encounter IDs must be unique.');
  const targetMembership = new Map<string, string[]>();
  for (const encounter of state.enemyEncounters) {
    if (duplicates(encounter.targetIds).length) errors.push(`Encounter ${encounter.encounterId} contains duplicate target IDs.`);
    if (encounter.resolutionPolicy && encounter.rulesModuleId && encounter.resolutionPolicy.moduleId !== encounter.rulesModuleId) errors.push(`Encounter ${encounter.encounterId} policy owner does not match its Rules Module.`);
    const partKeys = new Set<string>();
    for (const targetId of encounter.targetIds) {
      const memberships = targetMembership.get(targetId) ?? [];
      memberships.push(encounter.encounterId);
      targetMembership.set(targetId, memberships);
      const target = state.enemyTargets[targetId];
      if (!target) errors.push(`Encounter ${encounter.encounterId} references unknown target ${targetId}.`);
      else if (target.parentEncounterId !== encounter.encounterId) errors.push(`Target ${targetId} does not point back to encounter ${encounter.encounterId}.`);
      else if (target.partKey !== undefined) { if (partKeys.has(target.partKey)) errors.push(`Encounter ${encounter.encounterId} contains duplicate part key ${target.partKey}.`); partKeys.add(target.partKey); }
    }
  }
  for (const [targetId, target] of Object.entries(state.enemyTargets)) {
    if (target.targetId !== targetId) errors.push(`Target record key ${targetId} does not match target ID ${target.targetId}.`);
    const memberships = targetMembership.get(targetId) ?? [];
    if (target.parentEncounterId && (memberships.length !== 1 || memberships[0] !== target.parentEncounterId)) errors.push(`Target ${targetId} must belong to exactly one parent encounter.`);
    if (duplicates(target.attachments).length || target.attachments.includes(target.cardInstanceId)) errors.push(`Target ${targetId} contains duplicate card references.`);
    if (target.health && (!Number.isFinite(target.health.current) || !Number.isFinite(target.health.max) || !Number.isInteger(target.health.current) || !Number.isInteger(target.health.max) || target.health.current < 0 || target.health.max < 0 || target.health.current > target.health.max)) errors.push(`Target ${targetId} has invalid health.`);
    const terminal = target.status === 'defeated' || target.status === 'removed';
    if (!terminal) {
      if (target.zoneId) {
        if (!state.zones[target.zoneId]?.cardIds.includes(target.cardInstanceId)) errors.push(`Target ${targetId} card is missing from zone ${target.zoneId}.`);
      } else addLocation(target.cardInstanceId, `target:${targetId}:card`);
      for (const cardId of target.attachments) addLocation(cardId, `target:${targetId}:attachment`);
    } else if (target.attachments.length) errors.push(`Terminal target ${targetId} retains attachments.`);
  }

  for (const cardId of Object.keys(state.cards)) {
    const cardLocations = locations.get(cardId) ?? [];
    if (cardLocations.length !== 1) errors.push(`Card ${cardId} must have exactly one location; found ${cardLocations.join(', ') || 'none'}.`);
  }
  return errors;
}

export function assertGameStateInvariants(state: GameState): void {
  const errors = validateGameStateInvariants(state);
  if (errors.length) throw new Error(`Invalid game state: ${errors.join(' ')}`);
}
