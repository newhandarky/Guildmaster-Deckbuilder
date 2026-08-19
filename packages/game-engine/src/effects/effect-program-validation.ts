import type { EffectContext, EffectDefinition, EffectNode, GameState } from '@guildmaster/game-protocol';
import type { Ruleset } from '../rules/ruleset.js';
import { dynamicCardChoiceCandidates, repeatedItemQueue, resolvedDeckOrder, resolvedPartyOrder, resolvedRepeatDiscard, resolveEffectPlayerId, resolveSelectableCardSource, sharedRowRefreshOptions, sourceLocations } from './effect-choice-resolution.js';

type SuspensionMatch =
  | { kind: 'choice'; node: Extract<EffectNode, { kind: 'choice' | 'choose-card' | 'choose-order-player-deck-top' | 'choose-order-player-party' | 'repeat-discard-hand-for-combat' | 'choose-shared-row-refresh-subset' }> }
  | { kind: 'counter-consent'; node: Extract<EffectNode, { kind: 'request-counter-consent' }> };
type SuspensionContinuation = { match: SuspensionMatch; remaining: readonly EffectNode[] };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const same = (left: unknown, right: unknown): boolean => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const unique = (candidates: readonly SuspensionContinuation[]): SuspensionContinuation[] => [...new Map(candidates.map((candidate) => [JSON.stringify(candidate), candidate])).values()];

/** Mirrors runtime queue expansion to bind a serialized suspension to one exact program cursor. */
function continuations(nodes: readonly EffectNode[], target: { kind: SuspensionMatch['kind']; id: string }, state?: GameState, ruleset?: Ruleset, context?: EffectContext): SuspensionContinuation[] {
  if (!nodes.length) return [];
  const [node, ...remaining] = nodes;
  if (!node) return [];
  if (node.kind === 'sequence') return continuations([...node.effects, ...remaining], target, state, ruleset, context);
  if (node.kind === 'conditional') return [...continuations([node.whenTrue, ...remaining], target, state, ruleset, context), ...continuations([...(node.whenFalse ? [node.whenFalse] : []), ...remaining], target, state, ruleset, context)];
  if (node.kind === 'choice') {
    const current = target.kind === 'choice' && node.choiceId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
    return [...current, ...node.options.flatMap(({ effect }) => continuations([effect, ...remaining], target, state, ruleset, context))];
  }
  if (node.kind === 'choose-card') {
    const current = target.kind === 'choice' && node.choiceId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
    return [...current, ...continuations([node.effect, ...remaining], target, state, ruleset, context), ...(node.zeroCandidateEffect ? continuations([node.zeroCandidateEffect, ...remaining], target, state, ruleset, context) : [])];
  }
  if (node.kind === 'choose-order-player-deck-top') return target.kind === 'choice' && node.orderId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
  if (node.kind === 'choose-order-player-party') return target.kind === 'choice' && node.orderId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
  if (node.kind === 'repeat-discard-hand-for-combat') return target.kind === 'choice' && node.choiceId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
  if (node.kind === 'choose-shared-row-refresh-subset') return target.kind === 'choice' && node.choiceId === target.id ? [{ match: { kind: 'choice' as const, node }, remaining }] : [];
  if (node.kind === 'random' || node.kind === 'roll-die') return node.outcomes.flatMap(({ effect }) => continuations([effect, ...remaining], target, state, ruleset, context));
  if (node.kind === 'request-counter-consent') {
    const current = target.kind === 'counter-consent' && node.requestId === target.id ? [{ match: { kind: 'counter-consent' as const, node }, remaining }] : [];
    return [...current, ...Object.values(node.outcomes).flatMap((effect) => continuations([effect, ...remaining], target, state, ruleset, context))];
  }
  if (node.kind === 'repeat-item-use-effect') {
    const repeated = repeatedItemQueue(state, ruleset, node, context);
    return repeated ? continuations([...repeated, ...remaining], target, state, ruleset, context) : [];
  }
  return continuations(remaining, target, state, ruleset, context);
}

export function validatePendingChoiceAgainstEffect(pending: import('@guildmaster/game-protocol').PendingEffectChoice, effect: EffectDefinition, state?: GameState, ruleset?: Ruleset): string | undefined {
  const candidates = unique(continuations([effect.body], { kind: 'choice', id: pending.choiceId }, state, ruleset, pending.context)).filter((candidate): candidate is SuspensionContinuation & { match: Extract<SuspensionMatch, { kind: 'choice' }> } => candidate.match.kind === 'choice');
  const matching = candidates.filter((candidate) => same(candidate.remaining, pending.remaining)); const node = matching[0]?.match.node;
  if (candidates.length > 0 && matching.length === 0) return 'Pending choice continuation cursor does not match its registered effect program.';
  if (matching.length !== 1 || !node) return 'Pending choice does not match its registered effect program.';
  if (node.kind === 'choice' && JSON.stringify(node.options) !== JSON.stringify(pending.options)) return 'Pending choice does not match its registered effect program.';
  if (node.kind === 'choose-card') {
    if (!pending.options.length || new Set(pending.options.map(({ id }) => id)).size !== pending.options.length) return 'Dynamic card choice options must be non-empty and unique.';
    if (!state || !ruleset) return 'Dynamic card choice validation requires the active state and ruleset.';
    const resolved = dynamicCardChoiceCandidates(state, ruleset, node, pending.context);
    const expectedOptionIds = [...(resolved.status === 'ready' ? resolved.candidates.map(({ cardId }) => cardId) : []), ...(node.skipOptionId ? [node.skipOptionId] : [])];
    if (resolved.status !== 'ready' || JSON.stringify(expectedOptionIds) !== JSON.stringify(pending.options.map(({ id }) => id))) return 'Dynamic card choice candidates do not match the current source zone and predicate.';
    const candidateLocations = new Map(resolved.candidates.map(({ cardId, location }) => [cardId, location]));
    const invalidOption = pending.options.find((option) => {
      if (node.skipOptionId && option.id === node.skipOptionId) return !same(option.effect, { kind: 'conditional', condition: { kind: 'always', value: false }, whenTrue: node.effect }) || !same(option.context, pending.context);
      const selectedLocation = candidateLocations.get(option.id);
      const expectedContext: EffectContext = { ...pending.context, cardRefs: { ...(pending.context.cardRefs ?? {}), [node.selectedCardKey]: option.id }, ...(node.selectedLocationKey && selectedLocation ? { locationRefs: { ...(pending.context.locationRefs ?? {}), [node.selectedLocationKey]: selectedLocation } } : {}) };
      return !same(option.effect, node.effect) || !same(option.context, expectedContext);
    });
    const expectedActorId = resolveEffectPlayerId(node.actor, pending.context); const expectedSource = resolveSelectableCardSource(node.from, pending.context);
    if (invalidOption) return `Dynamic card choice options do not match their registered effect program (option ${invalidOption.id}).`;
    if (!expectedActorId || expectedActorId !== pending.actorId) return 'Dynamic card choice actor does not match its registered effect program.';
    if (!expectedSource || sourceLocations(expectedSource).some((location) => location.kind !== 'shared-zone' && location.player.playerId !== expectedActorId) || JSON.stringify(pending.source) !== JSON.stringify(expectedSource)) return 'Dynamic card choice source does not match its registered effect program.';
  }
  if (node.kind === 'choose-order-player-deck-top') {
    if (!state || !ruleset || !pending.order) return 'Deck-order validation requires active state, ruleset, and ordering metadata.';
    const resolved = resolvedDeckOrder(structuredClone(state), node, pending.context);
    if (resolved.status !== 'ready') return 'Pending deck order no longer has the registered candidates.';
    const expectedOptions = resolved.resolutions.map(({ optionId }) => ({ id: optionId, effect: { kind: 'conditional' as const, condition: { kind: 'always' as const, value: false }, whenTrue: { kind: 'draw' as const, player: { kind: 'controller' as const }, count: 0 } } }));
    if (pending.actorId !== resolved.actorId || pending.choiceId !== node.orderId || pending.decisionKind !== 'choose-order' || !same(pending.options, expectedOptions) || !same(pending.order, { playerId: resolved.targetId, cardIds: resolved.cardIds, mayRemove: node.mayRemove, resolutions: resolved.resolutions })) return 'Pending deck order does not match its registered effect program.';
  }
  if (node.kind === 'choose-order-player-party') {
    if (!state || !ruleset || !pending.order) return 'Party-order validation requires active state, ruleset, and ordering metadata.';
    const resolved = resolvedPartyOrder(state, node, pending.context);
    if (resolved.status !== 'ready') return 'Pending party order no longer has the registered candidates.';
    const expectedOptions = resolved.resolutions.map(({ optionId }) => ({ id: optionId, effect: { kind: 'conditional' as const, condition: { kind: 'always' as const, value: false }, whenTrue: { kind: 'draw' as const, player: { kind: 'controller' as const }, count: 0 } } }));
    if (pending.actorId !== resolved.actorId || pending.choiceId !== node.orderId || pending.decisionKind !== 'choose-order' || !same(pending.options, expectedOptions) || !same(pending.order, { kind: 'party', playerId: resolved.targetId, cardIds: resolved.cardIds, mayRemove: false, resolutions: resolved.resolutions })) return 'Pending party order does not match its registered effect program.';
  }
  if (node.kind === 'repeat-discard-hand-for-combat') {
    if (!state || !ruleset) return 'Repeated discard validation requires active state and ruleset.';
    const resolved = resolvedRepeatDiscard(state, node, pending.context);
    if (resolved.status !== 'ready' || pending.actorId !== resolved.actorId || pending.decisionKind !== 'discard-card' || !same(pending.options, resolved.options) || !same(pending.source, resolved.source)) return 'Pending repeated discard does not match its registered effect program.';
  }
  if (node.kind === 'choose-shared-row-refresh-subset') {
    if (!state || !ruleset) return 'Shared-row refresh validation requires active state and ruleset.';
    const resolved = sharedRowRefreshOptions(state, node, pending.context);
    if (resolved.status !== 'ready' || pending.actorId !== resolved.actorId || pending.decisionKind !== 'choose-enemy-target' || !same(pending.options, resolved.options) || !same(pending.source, resolved.source)) return 'Pending shared-row refresh does not match its registered effect program.';
  }
  return undefined;
}

export function validatePendingCounterConsentAgainstEffect(pending: import('@guildmaster/game-protocol').PendingCounterConsent, effect: EffectDefinition, state?: GameState, ruleset?: Ruleset): string | undefined {
  const candidates = unique(continuations([effect.body], { kind: 'counter-consent', id: pending.requestId }, state, ruleset, pending.context)).filter((candidate): candidate is SuspensionContinuation & { match: Extract<SuspensionMatch, { kind: 'counter-consent' }> } => candidate.match.kind === 'counter-consent');
  const matching = candidates.filter((candidate) => same(candidate.remaining, pending.remaining)); const request = matching[0]?.match.node;
  if (candidates.length > 0 && matching.length === 0) return 'Pending counter consent continuation cursor does not match its registered effect program.';
  if (matching.length !== 1 || !request || JSON.stringify(request.policy) !== JSON.stringify(pending.policy) || JSON.stringify(request.outcomes) !== JSON.stringify(pending.outcomes)) return 'Pending counter consent does not match its registered effect program.';
  return undefined;
}
