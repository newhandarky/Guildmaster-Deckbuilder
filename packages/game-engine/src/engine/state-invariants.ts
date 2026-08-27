import { isFiniteJsonValue, type GameState } from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { attachedCardIds } from '../model/attachments.js';
import { bondCompletionTimingFor } from '../rules/bond-condition-evaluator.js';

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
  if (!state.turnFacts || state.turnFacts.playerId !== state.activePlayerId) errors.push('Turn fact ledger must belong to the active player.');
  if (state.turnFacts?.effectUses && Object.entries(state.turnFacts.effectUses).some(([usageId, count]) => !usageId.trim() || !Number.isInteger(count) || count < 0)) errors.push('Turn effect use ledger is invalid.');
  if (state.turnFacts?.enemyCardPurchaseBonusPerCard !== undefined && (!Number.isInteger(state.turnFacts.enemyCardPurchaseBonusPerCard) || !Number.isFinite(state.turnFacts.enemyCardPurchaseBonusPerCard))) errors.push('Turn enemy-card purchase bonus is invalid.');
  if (state.status === 'setup') {
    const setup = state.bondSetup;
    if (!setup || setup.currentActorId !== state.activePlayerId || !playerIds.includes(setup.currentActorId)) errors.push('Bond setup must identify the active actor.');
    else {
      if (duplicates(setup.completedPlayerIds).length || setup.completedPlayerIds.some((id) => !playerIds.includes(id))) errors.push('Bond setup completed players are invalid.');
      const offered = playerIds.flatMap((id) => setup.offers[id] ?? []);
      if (playerIds.some((id) => setup.offers[id]?.length !== 7) || duplicates(offered).length) errors.push('Bond setup must contain seven unique offers per player.');
      for (const player of state.players) {
        const completed = setup.completedPlayerIds.includes(player.id);
        if ((completed && player.bonds.length !== 5) || (!completed && player.bonds.length !== 0)) errors.push(`Player ${player.id} bond setup state is inconsistent.`);
      }
    }
  } else if (state.bondSetup) errors.push('Bond setup must be absent after setup completes.');
  const bondOpportunity = state.pendingBondCompletion;
  if (bondOpportunity) {
    const owner = state.players.find(({ id }) => id === bondOpportunity.playerId);
    if (!bondOpportunity.opportunityId.trim() || bondOpportunity.playerId !== state.activePlayerId || !owner || !bondOpportunity.bondIds.length || duplicates(bondOpportunity.bondIds).length || bondOpportunity.bondIds.some((bondId) => !owner.bonds.some((bond) => bond.bondId === bondId && !bond.completed))) errors.push('Pending bond completion opportunity is invalid.');
  }
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
    if (typeof player.turnMarketRefreshed !== 'boolean') errors.push(`Player ${player.id} market refresh flag is missing.`);
    if (duplicates(player.counters.map(({ resourceId }) => resourceId)).length) errors.push(`Player ${player.id} counters must have unique resource IDs.`);
    for (const zoneName of ['drawPile', 'hand', 'discardPile', 'playArea'] as const) {
      if (duplicates(player[zoneName]).length) errors.push(`Player ${player.id} ${zoneName} contains duplicate cards.`);
      for (const cardId of player[zoneName]) addLocation(cardId, `player:${player.id}:${zoneName}`);
    }
    player.party.forEach((slot, index) => {
      addLocation(slot.adventurerId, `player:${player.id}:party:${index}`);
      const attachments = attachedCardIds(slot);
      if (duplicates(attachments).length) errors.push(`Player ${player.id} party slot ${index} contains duplicate attachments.`);
      for (const cardId of attachments) addLocation(cardId, `player:${player.id}:equipment:${index}`);
    });
  }
  const consent = state.effectState.pendingCounterConsent;
  if (consent) {
    if (state.effectState.pendingChoice) errors.push('Counter consent and effect choice cannot be pending together.');
    if (!playerIds.includes(consent.counterOwnerId) || consent.requesterId !== consent.counterOwnerId || consent.context.controllerId !== consent.requesterId) errors.push('Pending counter consent has an invalid owner, requester, or context.');
    if (!consent.requiredActorIds.length || duplicates(consent.requiredActorIds).length || duplicates(consent.acceptedActorIds).length || consent.requiredActorIds.includes(consent.requesterId) || consent.acceptedActorIds.some((id) => !consent.requiredActorIds.includes(id)) || consent.requiredActorIds.some((id) => !playerIds.includes(id)) || consent.requiredActorIds.every((id) => consent.acceptedActorIds.includes(id))) errors.push('Pending counter consent responder sets are invalid.');
  }
  const order = state.effectState.pendingChoice?.order;
  if (order) {
    const choice = state.effectState.pendingChoice!; const owner = state.players.find(({ id }) => id === order.playerId);
    const currentCardIds = order.kind === 'party' ? owner?.party.map(({ adventurerId }) => adventurerId) : owner?.drawPile.slice(-order.cardIds.length);
    if (choice.decisionKind !== 'choose-order' || choice.actorId !== order.playerId || !owner || !order.cardIds.length || duplicates(order.cardIds).length || JSON.stringify(currentCardIds) !== JSON.stringify(order.cardIds)) errors.push('Pending order owner or candidate cards are invalid.');
    if (order.kind === 'party' && order.mayRemove) errors.push('Pending party order cannot remove a member.');
    if (!order.resolutions.length || duplicates(order.resolutions.map(({ optionId }) => optionId)).length || JSON.stringify(choice.options.map(({ id }) => id)) !== JSON.stringify(order.resolutions.map(({ optionId }) => optionId))) errors.push('Pending order options are invalid.');
    const inspected = [...order.cardIds].sort();
    for (const resolution of order.resolutions) {
      const selected = [...resolution.orderedCardIds, ...(resolution.removeCardId ? [resolution.removeCardId] : [])];
      if ((!order.mayRemove && resolution.removeCardId) || duplicates(selected).length || JSON.stringify([...selected].sort()) !== JSON.stringify(inspected)) errors.push(`Pending order resolution ${resolution.optionId} is not an exact permutation.`);
    }
  }
  if (duplicates(state.removedCards).length) errors.push('Removed cards contains duplicate IDs.');
  for (const cardId of state.removedCards) addLocation(cardId, 'removed');

  const encounterIds = state.enemyEncounters.map(({ encounterId }) => encounterId);
  if (duplicates(encounterIds).length) errors.push('Encounter IDs must be unique.');
  const targetMembership = new Map<string, string[]>();
  for (const encounter of state.enemyEncounters) {
    if (duplicates(encounter.targetIds).length) errors.push(`Encounter ${encounter.encounterId} contains duplicate target IDs.`);
    if (encounter.status === 'finished' && !encounter.resolutionPolicy) errors.push(`Finished encounter ${encounter.encounterId} must have a resolution policy.`);
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

  const modifierIds = new Set<string>();
  for (const modifier of state.temporaryTargetModifiers ?? []) {
    const turnExpiryValid = modifier.expiresAtTurnEndPlayerId !== undefined && state.players.some(({ id }) => id === modifier.expiresAtTurnEndPlayerId);
    const targetExpiryValid = modifier.expiresWhenTargetLeaves === true && Object.values(state.enemyTargets).some(({ cardInstanceId, status }) => cardInstanceId === modifier.targetCardId && status === 'available');
    if (!modifier.modifierId.trim() || modifierIds.has(modifier.modifierId) || !modifier.moduleId.trim() || !state.cards[modifier.targetCardId] || !Number.isFinite(modifier.amount) || !Number.isInteger(modifier.amount) || turnExpiryValid === targetExpiryValid) errors.push(`Temporary target modifier ${modifier.modifierId || '<empty>'} is invalid.`);
    modifierIds.add(modifier.modifierId);
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

/** Validates module-owned zone contracts and setup-selected card pools. */
export function validateRulesetGameStateInvariants(state: GameState, ruleset: Ruleset): string[] {
  const errors: string[] = [];
  if (state.pendingBondCompletion) {
    for (const bondId of state.pendingBondCompletion.bondIds) {
      if (bondCompletionTimingFor(ruleset, bondId) !== state.pendingBondCompletion.timing) errors.push(`Pending bond completion opportunity timing does not match bond ${bondId}.`);
    }
  }
  if (state.bondSetup) {
    const bondIds = new Set(ruleset.registry.bonds.map(({ id }) => id));
    for (const [playerId, offer] of Object.entries(state.bondSetup.offers)) if (offer.some((bondId) => !bondIds.has(bondId))) errors.push(`Bond setup offer for ${playerId} contains an unknown bond.`);
    for (const player of state.players) if (player.bonds.some(({ bondId }) => !bondIds.has(bondId) || !state.bondSetup!.offers[player.id]?.includes(bondId))) errors.push(`Player ${player.id} selected a bond outside the authoritative offer.`);
  }
  const moduleIds = new Set(ruleset.modules.map(({ id }) => id));
  for (const module of ruleset.modules) {
    if (!(module.id in state.moduleState)) {
      errors.push(`Rules Module state ${module.id} is missing.`);
      continue;
    }
    for (const error of module.validateState?.(state.moduleState[module.id]) ?? []) {
      errors.push(`Rules Module state ${module.id} is invalid: ${error}`);
    }
  }
  for (const moduleId of Object.keys(state.moduleState)) {
    if (!moduleIds.has(moduleId)) errors.push(`Unknown Rules Module state ${moduleId}.`);
  }
  const zoneDefinitions = ruleset.modules.flatMap((module) => module.zoneDefinitions ?? []);
  for (const definition of zoneDefinitions) {
    const zone = state.zones[definition.zoneId];
    if (!zone) {
      errors.push(`Rules Module zone ${definition.zoneId} is missing.`);
      continue;
    }
    if (zone.kind !== definition.kind || zone.visibility !== definition.visibility || zone.rulesModuleId !== definition.rulesModuleId) {
      errors.push(`Rules Module zone ${definition.zoneId} does not match its registered definition.`);
    }
  }
  const setupContributions = ruleset.modules.flatMap((module) => module.setupContributions ?? []);
  const setupContributionIds = new Set(setupContributions.map(({ contributionId }) => contributionId));
  if (!setupContributions.length && state.setupSelections !== undefined) errors.push('Setup selection registry must be absent when the ruleset has no setup contributions.');
  if (setupContributions.length && !state.setupSelections) errors.push('Setup selection registry is missing.');
  for (const contributionId of Object.keys(state.setupSelections ?? {})) {
    if (!setupContributionIds.has(contributionId)) errors.push(`Unknown setup selection ${contributionId}.`);
  }
  for (const contribution of setupContributions) {
    const configs = ruleset.modules.flatMap((candidate) => candidate.supplyRowConfigurations ?? [])
      .filter(({ sourceDeckZoneId }) => sourceDeckZoneId === contribution.destinationZoneId);
    const configurationIds = new Set(configs.map(({ configurationId }) => configurationId));
    const allowedZoneIds = new Set([
      contribution.destinationZoneId,
      ...configs.map(({ targetRowZoneId }) => targetRowZoneId),
      ...ruleset.modules.flatMap((candidate) => candidate.supplyRowRefreshPolicies ?? [])
        .filter(({ supplyRowConfigurationId }) => configurationIds.has(supplyRowConfigurationId))
        .map(({ destinationZoneId }) => destinationZoneId),
    ]);
    const allowedCardIds = new Set([...allowedZoneIds].flatMap((zoneId) => state.zones[zoneId]?.cardIds ?? []));
    const selection = state.setupSelections?.[contribution.contributionId];
    if (!selection) {
      errors.push(`Setup contribution ${contribution.contributionId} has no recorded selection.`);
      continue;
    }
    if (selection.contributionId !== contribution.contributionId || selection.moduleId !== contribution.moduleId || selection.destinationZoneId !== contribution.destinationZoneId) {
      errors.push(`Setup contribution ${contribution.contributionId} selection identity is invalid.`);
    }
    if (selection.cardIds.length !== selection.definitionIds.length || duplicates(selection.cardIds).length) {
      errors.push(`Setup contribution ${contribution.contributionId} selection records are malformed.`);
    }
    const selectedCardIds = new Set(selection.cardIds);
    if (allowedCardIds.size !== selectedCardIds.size || [...allowedCardIds].some((cardId) => !selectedCardIds.has(cardId))) {
      errors.push(`Setup contribution ${contribution.contributionId} must retain exactly its ${selectedCardIds.size} recorded cards; found ${allowedCardIds.size}.`);
    }
    selection.cardIds.forEach((cardId, index) => {
      if (state.cards[cardId]?.definitionId !== selection.definitionIds[index]) {
        errors.push(`Setup contribution ${contribution.contributionId} card ${cardId} does not match its recorded definition.`);
      }
    });
    for (const zoneId of allowedZoneIds) for (const cardId of state.zones[zoneId]?.cardIds ?? []) {
      const definitionId = state.cards[cardId]?.definitionId;
      if (!definitionId || ruleset.registry.definitions[definitionId]?.type !== contribution.selector.value) {
        errors.push(`Setup contribution ${contribution.contributionId} zone ${zoneId} contains a non-matching card ${cardId}.`);
      }
    }
    for (const card of Object.values(state.cards)) {
      if (ruleset.registry.definitions[card.definitionId]?.type === contribution.selector.value && !selectedCardIds.has(card.id)) {
        errors.push(`Setup contribution ${contribution.contributionId} card ${card.id} left its registered zones.`);
      }
    }
  }
  return errors;
}

export function assertRulesetGameStateInvariants(state: GameState, ruleset: Ruleset): void {
  const errors = validateRulesetGameStateInvariants(state, ruleset);
  if (errors.length) throw new Error(`Invalid ruleset game state: ${errors.join(' ')}`);
}
