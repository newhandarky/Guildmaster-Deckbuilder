import { validateEffectCardPredicate, type EffectCardPredicate, type EffectConcreteCardLocation, type EffectContext, type EffectNode, type EffectSelectableCardLocation, type EffectSelectableCardSource, type GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { getZone } from '../model/zones.js';
import { shuffle } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { resolveCardId } from './movement.js';

export type DynamicCardChoiceNode = Extract<EffectNode, { kind: 'choose-card' }>;
export type ResolvedSelectableCardLocation = { kind: 'player-zone'; player: { kind: 'player-id'; playerId: string }; zone: 'hand' | 'discardPile' | 'playArea' } | { kind: 'party'; player: { kind: 'player-id'; playerId: string } } | { kind: 'shared-zone'; zoneId: string };
export type ResolvedSelectableCardSource = ResolvedSelectableCardLocation | { kind: 'one-of'; locations: readonly ResolvedSelectableCardLocation[] };
type DynamicCardChoiceCandidate = { cardId: string; location: EffectConcreteCardLocation };
export type DynamicCardChoiceCandidates = { status: 'ready'; actorId: string; source: ResolvedSelectableCardSource; candidates: DynamicCardChoiceCandidate[] } | { status: 'failed'; error: string };
type OrderNode = Extract<EffectNode, { kind: 'choose-order-player-deck-top' }>;
type PartyOrderNode = Extract<EffectNode, { kind: 'choose-order-player-party' }>;
type RepeatDiscardNode = Extract<EffectNode, { kind: 'repeat-discard-hand-for-combat' }>;
type SharedRowRefreshNode = Extract<EffectNode, { kind: 'choose-shared-row-refresh-subset' }>;
const MAX_ORDER_CARDS = 5;

export const resolveEffectPlayerId = (ref: import('@guildmaster/game-protocol').EffectPlayerRef, context: EffectContext): string | undefined => ref.kind === 'controller' ? context.controllerId : ref.kind === 'player-id' ? ref.playerId : context.playerRefs?.[ref.key];

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  return values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [value, ...tail]));
}

function deckOrderResolutions(cardIds: readonly string[], mayRemove: boolean): import('@guildmaster/game-protocol').PendingEffectOrder['resolutions'] {
  const entries: Array<{ optionId: string; orderedCardIds: string[]; removeCardId?: string }> = [];
  const add = (orderedCardIds: string[], removeCardId?: string): void => { entries.push({ optionId: `order-${entries.length + 1}`, orderedCardIds, ...(removeCardId ? { removeCardId } : {}) }); };
  for (const ordered of permutations(cardIds)) add(ordered);
  if (mayRemove) for (const removeCardId of cardIds) for (const ordered of permutations(cardIds.filter((id) => id !== removeCardId))) add(ordered, removeCardId);
  return entries;
}

function bindItemSource(node: EffectNode, cardId: string): EffectNode {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.kind === 'context-card' && record.key === 'source') return { kind: 'card-instance', cardInstanceId: cardId };
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, visit(entry)]));
  };
  return visit(node) as EffectNode;
}

export function resolvedDeckOrder(state: GameState, node: OrderNode, context: EffectContext) {
  const actorId = resolveEffectPlayerId(node.actor, context); const targetId = resolveEffectPlayerId(node.player, context);
  if (!actorId || !targetId || actorId !== targetId) return { status: 'failed' as const, error: 'Deck ordering must be performed by the owner.' };
  const player = getPlayer(state, targetId);
  if (!player.drawPile.length && player.discardPile.length) { player.drawPile = shuffle(state, player.discardPile); player.discardPile = []; }
  const cardIds = player.drawPile.slice(-node.count);
  if (!cardIds.length) return { status: 'empty' as const };
  return { status: 'ready' as const, actorId, targetId, cardIds, resolutions: deckOrderResolutions(cardIds, node.mayRemove) };
}

export function resolvedPartyOrder(state: GameState, node: PartyOrderNode, context: EffectContext) {
  const actorId = resolveEffectPlayerId(node.actor, context); const targetId = resolveEffectPlayerId(node.player, context);
  if (!actorId || !targetId || actorId !== targetId) return { status: 'failed' as const, error: 'Party ordering must be performed by the owner.' };
  const cardIds = getPlayer(state, targetId).party.map(({ adventurerId }) => adventurerId);
  if (!cardIds.length) return { status: 'empty' as const };
  if (cardIds.length > MAX_ORDER_CARDS) return { status: 'failed' as const, error: `Party ordering supports at most ${MAX_ORDER_CARDS} cards.` };
  return { status: 'ready' as const, actorId, targetId, cardIds, resolutions: deckOrderResolutions(cardIds, false) };
}

export function resolvedRepeatDiscard(state: GameState, node: RepeatDiscardNode, context: EffectContext) {
  const actorId = resolveEffectPlayerId(node.actor, context); const targetId = resolveEffectPlayerId(node.player, context);
  if (!actorId || !targetId || actorId !== targetId) return { status: 'failed' as const, error: 'Repeated discard must be performed by the hand owner.' };
  const handIds = [...getPlayer(state, targetId).hand];
  if (handIds.includes(node.stopOptionId)) return { status: 'failed' as const, error: 'Repeated discard stop option collides with a card ID.' };
  const repeat = structuredClone(node);
  const options: { id: string; effect: EffectNode }[] = [
    { id: node.stopOptionId, effect: { kind: 'conditional', condition: { kind: 'always', value: false }, whenTrue: { kind: 'draw', player: { kind: 'controller' }, count: 0 } } },
    ...handIds.map((cardId): { id: string; effect: EffectNode } => ({ id: cardId, effect: { kind: 'sequence', effects: [
      { kind: 'discard-card', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'player-zone', player: { kind: 'player-id', playerId: targetId }, zone: 'hand' }, permission: 'system' },
      { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'player-id', playerId: targetId } }, amount: node.amountPerCard }, repeat,
    ] } })),
  ];
  return { status: 'ready' as const, actorId, targetId, options, source: { kind: 'player-zone' as const, player: { kind: 'player-id' as const, playerId: targetId }, zone: 'hand' as const } };
}

export function sharedRowRefreshOptions(state: GameState, node: SharedRowRefreshNode, context: EffectContext) {
  const actorId = resolveEffectPlayerId(node.actor, context); const row = state.zones[node.rowZoneId]; const deck = state.zones[node.sourceDeckZoneId];
  if (!actorId || !row || row.visibility !== 'public' || !deck || deck.kind !== 'orderedDeck') return { status: 'failed' as const, error: 'Shared-row refresh requires a resolved actor, public row, and ordered source deck.' };
  if (row.cardIds.length > node.maxSelections) return { status: 'failed' as const, error: 'Shared-row refresh row exceeds its registered selection limit.' };
  const options = Array.from({ length: 2 ** row.cardIds.length }, (_, mask) => {
    const cardIds = row.cardIds.filter((_, index) => (mask & (1 << index)) !== 0);
    return { id: `refresh-${mask}`, effect: { kind: 'refresh-shared-row-selection' as const, rowZoneId: node.rowZoneId, sourceDeckZoneId: node.sourceDeckZoneId, cardIds } };
  });
  return { status: 'ready' as const, actorId, options, source: { kind: 'shared-zone' as const, zoneId: node.rowZoneId } };
}

export function matchesCardPredicate(state: GameState, ruleset: Ruleset, cardId: string, predicate: EffectCardPredicate): boolean {
  const card = state.cards[cardId]; const definition = card ? ruleset.registry.definitions[card.definitionId] : undefined;
  if (!card || !definition) return false;
  if (predicate.kind === 'definition-type-in') return predicate.values.includes(definition.type);
  if (predicate.kind === 'definition-id-in') return predicate.values.includes(card.definitionId);
  if (predicate.kind === 'definition-cost-at-most') return definition.cost !== undefined && definition.cost <= predicate.value;
  if (predicate.kind === 'tag-in') return predicate.values.some((tag) => definition.tags?.includes(tag));
  if (predicate.kind === 'tag-prefix') return definition.tags?.some((tag) => tag.startsWith(predicate.value)) ?? false;
  if (predicate.kind === 'definition-has-use-effect') return definition.useEffect !== undefined;
  if (predicate.kind === 'all') return predicate.predicates.every((entry) => matchesCardPredicate(state, ruleset, cardId, entry));
  if (predicate.kind === 'any') return predicate.predicates.some((entry) => matchesCardPredicate(state, ruleset, cardId, entry));
  return !matchesCardPredicate(state, ruleset, cardId, predicate.predicate);
}

function resolveSelectableCardLocation(location: EffectSelectableCardLocation, context: EffectContext): ResolvedSelectableCardLocation | undefined {
  if (location.kind === 'shared-zone') return location;
  const ownerId = resolveEffectPlayerId(location.player, context);
  if (!ownerId) return undefined;
  return location.kind === 'party' ? { kind: 'party', player: { kind: 'player-id', playerId: ownerId } } : { kind: 'player-zone', player: { kind: 'player-id', playerId: ownerId }, zone: location.zone };
}

export function resolveSelectableCardSource(source: EffectSelectableCardSource, context: EffectContext): ResolvedSelectableCardSource | undefined {
  if (source.kind !== 'one-of') return resolveSelectableCardLocation(source, context);
  const locations = source.locations.map((location) => resolveSelectableCardLocation(location, context));
  return locations.every((location): location is ResolvedSelectableCardLocation => Boolean(location)) ? { kind: 'one-of', locations } : undefined;
}

export function sourceLocations(source: ResolvedSelectableCardSource): readonly ResolvedSelectableCardLocation[] { return source.kind === 'one-of' ? source.locations : [source]; }

function candidatesAtLocation(state: GameState, actorId: string, location: ResolvedSelectableCardLocation): DynamicCardChoiceCandidate[] {
  if (location.kind === 'shared-zone') return getZone(state, location.zoneId).cardIds.map((cardId) => ({ cardId, location }));
  const player = getPlayer(state, actorId);
  if (location.kind === 'player-zone') return player[location.zone].map((cardId) => ({ cardId, location }));
  return player.party.map((slot, position) => ({ cardId: slot.adventurerId, location: { kind: 'party', player: location.player, position } }));
}

export function dynamicCardChoiceCandidates(state: GameState, ruleset: Ruleset, node: DynamicCardChoiceNode, context: EffectContext): DynamicCardChoiceCandidates {
  const predicateErrors = node.predicate ? validateEffectCardPredicate(node.predicate) : [];
  if (predicateErrors.length) return { status: 'failed', error: `Dynamic card choice predicate is invalid: ${predicateErrors.join(' ')}` };
  const actorId = resolveEffectPlayerId(node.actor, context); const visibleSource = resolveSelectableCardSource(node.from, context);
  if (!actorId || !visibleSource) return { status: 'failed', error: 'Dynamic card choice actor or source could not be resolved.' };
  for (const location of sourceLocations(visibleSource)) {
    if (location.kind === 'shared-zone') { const zone = state.zones[location.zoneId]; if (!zone || zone.visibility !== 'public') return { status: 'failed', error: 'Dynamic card choice shared zone must exist and be public.' }; }
    else if (location.player.playerId !== actorId) return { status: 'failed', error: 'Dynamic card choice must resolve to the choosing actor\'s visible zones or party.' };
  }
  const predicate = node.predicate;
  const candidates = sourceLocations(visibleSource).flatMap((location) => candidatesAtLocation(state, actorId, location)).filter(({ cardId }) => !predicate || matchesCardPredicate(state, ruleset, cardId, predicate));
  if (new Set(candidates.map(({ cardId }) => cardId)).size !== candidates.length) return { status: 'failed', error: 'Dynamic card choice source resolves the same card more than once.' };
  return { status: 'ready', actorId, source: visibleSource, candidates };
}

function repeatableItemBody(node: EffectNode): EffectNode {
  if (node.kind === 'record-turn-effect-use') return { kind: 'conditional', condition: { kind: 'always', value: false }, whenTrue: { kind: 'draw', player: { kind: 'controller' }, count: 0 } };
  if (node.kind === 'sequence') return { ...node, effects: node.effects.map(repeatableItemBody) };
  if (node.kind === 'conditional') return { ...node, whenTrue: repeatableItemBody(node.whenTrue), ...(node.whenFalse ? { whenFalse: repeatableItemBody(node.whenFalse) } : {}) };
  if (node.kind === 'choice') return { ...node, options: node.options.map((option) => ({ ...option, effect: repeatableItemBody(option.effect) })) };
  if (node.kind === 'choose-card') return { ...node, effect: repeatableItemBody(node.effect), ...(node.zeroCandidateEffect ? { zeroCandidateEffect: repeatableItemBody(node.zeroCandidateEffect) } : {}) };
  if (node.kind === 'random') return { ...node, outcomes: node.outcomes.map((outcome) => ({ ...outcome, effect: repeatableItemBody(outcome.effect) })) };
  if (node.kind === 'roll-die') return { ...node, outcomes: node.outcomes.map((outcome) => ({ ...outcome, effect: repeatableItemBody(outcome.effect) })) };
  if (node.kind === 'request-counter-consent') return { ...node, outcomes: Object.fromEntries(Object.entries(node.outcomes).map(([key, effect]) => [key, repeatableItemBody(effect)])) as typeof node.outcomes };
  return structuredClone(node);
}

export function repeatedItemQueue(state: GameState | undefined, ruleset: Ruleset | undefined, node: Extract<EffectNode, { kind: 'repeat-item-use-effect' }>, context: EffectContext | undefined): EffectNode[] | undefined {
  if (!state || !ruleset || !context) return undefined;
  const cardId = resolveCardId(node.card, context); const card = cardId ? state.cards[cardId] : undefined; const definition = card ? ruleset.registry.definitions[card.definitionId] : undefined;
  if (!definition?.useEffect || definition.type !== 'item') return undefined;
  const body = bindItemSource(definition.useEffect.body, cardId!);
  return [structuredClone(body), ...Array.from({ length: node.times - 1 }, () => repeatableItemBody(body))];
}
