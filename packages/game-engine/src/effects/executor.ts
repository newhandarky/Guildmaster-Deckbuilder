import { validateEffectCardPredicate, validateEffectDefinition, type CounterConsentAction, type CounterConsentEvaluation, type DomainEvent, type EffectCardLocation, type EffectCardPredicate, type EffectContext, type EffectDefinition, type EffectNode, type GameState } from '@guildmaster/game-protocol';
import { drawCards } from '../engine/draw.js';
import { getPlayer } from '../model/factories.js';
import { nextRandom } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { isCardAtLocation, moveCard, resolveCardId, resolveLocation } from './movement.js';
import { evaluateSupplyRowRefresh } from '../rules/supply-row-refresh-evaluator.js';
import { refillSupplyConfiguration } from '../engine/supply.js';
import { getZone } from '../model/zones.js';
import { attachCardToEnemyTarget, createEnemyEncounter, createEnemyTarget, damageEnemyTarget, defeatEnemyTarget, finishEnemyEncounter, removeEnemyTarget } from '../engine/encounter-resolution.js';
import { evaluateDiceRoll } from '../rules/dice-evaluator.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';

export type EffectOrderResolution = { status: 'ready'; orderedIds: readonly string[] } | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED' };
/** Never infer trigger/replacement ordering from array order or active player. */
export function resolveEffectOrder(entries: readonly { id: string; priority?: number }[], policy?: 'explicit-priority'): EffectOrderResolution {
  if (entries.length < 2) return { status: 'ready', orderedIds: entries.map((entry) => entry.id) };
  if (policy !== 'explicit-priority' || entries.some((entry) => entry.priority === undefined)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  const ordered = [...entries].sort((left, right) => left.priority! - right.priority!); if (ordered.some((entry, index) => index > 0 && entry.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  return { status: 'ready', orderedIds: ordered.map((entry) => entry.id) };
}

export type EffectExecutionResult = { status: 'completed' | 'suspended' | 'failed' | 'unsupported'; events: DomainEvent[]; error?: string };
export type EffectPreviewUncertainty = { usesRandomness: boolean; observesHiddenInformation: boolean };
const domainEvent = (state: GameState, events: DomainEvent[], type: string, message: string) => events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message });
const playerId = (ref: import('@guildmaster/game-protocol').EffectPlayerRef, context: EffectContext) => ref.kind === 'controller' ? context.controllerId : ref.kind === 'player-id' ? ref.playerId : context.playerRefs?.[ref.key];
function commitState(target: GameState, source: GameState): void { Object.assign(target, source); }
type DynamicCardChoiceNode = Extract<EffectNode, { kind: 'choose-card' }>;
type ResolvedSelectableCardLocation = { kind: 'player-zone'; player: { kind: 'player-id'; playerId: string }; zone: 'hand' | 'discardPile' | 'playArea' };
type DynamicCardChoiceCandidates = { status: 'ready'; actorId: string; source: ResolvedSelectableCardLocation; cardIds: string[] } | { status: 'failed'; error: string };

function matchesCardPredicate(state: GameState, ruleset: Ruleset, cardId: string, predicate: EffectCardPredicate): boolean {
  const card = state.cards[cardId];
  const definition = card ? ruleset.registry.definitions[card.definitionId] : undefined;
  if (!card || !definition) return false;
  if (predicate.kind === 'definition-type-in') return predicate.values.includes(definition.type);
  if (predicate.kind === 'definition-id-in') return predicate.values.includes(card.definitionId);
  if (predicate.kind === 'tag-in') return predicate.values.some((tag) => definition.tags?.includes(tag));
  if (predicate.kind === 'all') return predicate.predicates.every((entry) => matchesCardPredicate(state, ruleset, cardId, entry));
  if (predicate.kind === 'any') return predicate.predicates.some((entry) => matchesCardPredicate(state, ruleset, cardId, entry));
  return !matchesCardPredicate(state, ruleset, cardId, predicate.predicate);
}

function dynamicCardChoiceCandidates(state: GameState, ruleset: Ruleset, node: DynamicCardChoiceNode, context: EffectContext): DynamicCardChoiceCandidates {
  const predicateErrors = node.predicate ? validateEffectCardPredicate(node.predicate) : [];
  if (predicateErrors.length) return { status: 'failed', error: `Dynamic card choice predicate is invalid: ${predicateErrors.join(' ')}` };
  const actorId = playerId(node.actor, context);
  const source = resolveLocation(node.from, context);
  if (!actorId || !source || source.kind !== 'player-zone' || source.player.kind !== 'player-id' || source.player.playerId !== actorId) return { status: 'failed', error: 'Dynamic card choice must resolve to the choosing actor\'s visible player zone.' };
  if (source.zone === 'drawPile') return { status: 'failed', error: 'Dynamic card choice cannot expose a hidden draw pile.' };
  const visibleSource: ResolvedSelectableCardLocation = { kind: 'player-zone', player: { kind: 'player-id', playerId: source.player.playerId }, zone: source.zone };
  const predicate = node.predicate;
  const cardIds = getPlayer(state, actorId)[visibleSource.zone].filter((cardId) => !predicate || matchesCardPredicate(state, ruleset, cardId, predicate));
  return { status: 'ready', actorId, source: visibleSource, cardIds };
}
const noPreviewUncertainty = (): EffectPreviewUncertainty => ({ usesRandomness: false, observesHiddenInformation: false });
const mergePreviewUncertainty = (values: readonly EffectPreviewUncertainty[]): EffectPreviewUncertainty => values.reduce((merged, value) => ({ usesRandomness: merged.usesRandomness || value.usesRandomness, observesHiddenInformation: merged.observesHiddenInformation || value.observesHiddenInformation }), noPreviewUncertainty());

function locationIsVisibleToViewer(location: EffectCardLocation, state: GameState, context: EffectContext, viewerId: string): boolean {
  if (location.kind === 'shared-zone') return state.zones[location.zoneId]?.visibility === 'public';
  if (location.kind === 'removed') return false;
  const ownerId = playerId(location.player, context);
  if (ownerId !== viewerId) return false;
  return location.kind !== 'player-zone' || location.zone !== 'drawPile';
}

/** Conservative metadata for deciding whether speculative effect execution is safe to expose in a PlayerView-derived query. */
export function inspectEffectPreviewUncertainty(node: EffectNode, state: GameState, context: EffectContext, viewerId: string): EffectPreviewUncertainty {
  if (node.kind === 'sequence') return mergePreviewUncertainty(node.effects.map((effect) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'conditional') return mergePreviewUncertainty([
    node.condition.kind === 'has-card-at' && !locationIsVisibleToViewer(node.condition.location, state, context, viewerId) ? { usesRandomness: false, observesHiddenInformation: true } : noPreviewUncertainty(),
    inspectEffectPreviewUncertainty(node.whenTrue, state, context, viewerId),
    ...(node.whenFalse ? [inspectEffectPreviewUncertainty(node.whenFalse, state, context, viewerId)] : []),
  ]);
  if (node.kind === 'choice') return mergePreviewUncertainty(node.options.map(({ effect }) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'choose-card') return mergePreviewUncertainty([
    { usesRandomness: false, observesHiddenInformation: !locationIsVisibleToViewer(node.from, state, context, viewerId) },
    inspectEffectPreviewUncertainty(node.effect, state, context, viewerId),
  ]);
  if (node.kind === 'random' || node.kind === 'roll-die') return mergePreviewUncertainty([
    { usesRandomness: true, observesHiddenInformation: false },
    ...node.outcomes.map(({ effect }) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)),
  ]);
  if (node.kind === 'request-counter-consent') return mergePreviewUncertainty(Object.values(node.outcomes).map((effect) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'draw') return { usesRandomness: false, observesHiddenInformation: node.count > 0 };
  if (node.kind === 'grant-combat-reward') return { usesRandomness: false, observesHiddenInformation: node.rewards.some((reward) => reward.kind === 'draw' && reward.count > 0) };
  if (node.kind === 'refresh-supply-row') return { usesRandomness: false, observesHiddenInformation: true };
  if (node.kind === 'create-enemy-encounter' || node.kind === 'create-enemy-target' || node.kind === 'attach-card-to-enemy-target' || node.kind === 'damage-enemy-target' || node.kind === 'defeat-enemy-target' || node.kind === 'remove-enemy-target' || node.kind === 'finish-enemy-encounter') {
    return { usesRandomness: false, observesHiddenInformation: true };
  }
  if (node.kind === 'move-card' || node.kind === 'discard-card' || node.kind === 'remove-from-game') {
    return { usesRandomness: false, observesHiddenInformation: !locationIsVisibleToViewer(node.from, state, context, viewerId) };
  }
  return noPreviewUncertainty();
}
type SuspensionMatch =
  | { kind: 'choice'; node: Extract<EffectNode, { kind: 'choice' | 'choose-card' }> }
  | { kind: 'counter-consent'; node: Extract<EffectNode, { kind: 'request-counter-consent' }> };
type SuspensionContinuation = { match: SuspensionMatch; remaining: readonly EffectNode[] };
function uniqueContinuations(candidates: readonly SuspensionContinuation[]): SuspensionContinuation[] {
  return [...new Map(candidates.map((candidate) => [JSON.stringify(candidate), candidate])).values()];
}

/**
 * Enumerates exact execution queues that can reach a suspension. This mirrors
 * runNodes queue expansion, including outer sequence tails, without evaluating
 * state-dependent branches.
 */
function suspensionContinuations(nodes: readonly EffectNode[], target: { kind: SuspensionMatch['kind']; id: string }): SuspensionContinuation[] {
  if (!nodes.length) return [];
  const [node, ...remaining] = nodes;
  if (!node) return [];
  if (node.kind === 'sequence') return suspensionContinuations([...node.effects, ...remaining], target);
  if (node.kind === 'conditional') {
    return [
      ...suspensionContinuations([node.whenTrue, ...remaining], target),
      ...suspensionContinuations([...(node.whenFalse ? [node.whenFalse] : []), ...remaining], target)
    ];
  }
  if (node.kind === 'choice') {
    const current = target.kind === 'choice' && node.choiceId === target.id
      ? [{ match: { kind: 'choice' as const, node }, remaining }]
      : [];
    return [...current, ...node.options.flatMap(({ effect }) => suspensionContinuations([effect, ...remaining], target))];
  }
  if (node.kind === 'choose-card') {
    const current = target.kind === 'choice' && node.choiceId === target.id
      ? [{ match: { kind: 'choice' as const, node }, remaining }]
      : [];
    return [...current, ...suspensionContinuations([node.effect, ...remaining], target)];
  }
  if (node.kind === 'random' || node.kind === 'roll-die') {
    return node.outcomes.flatMap(({ effect }) => suspensionContinuations([effect, ...remaining], target));
  }
  if (node.kind === 'request-counter-consent') {
    const current = target.kind === 'counter-consent' && node.requestId === target.id
      ? [{ match: { kind: 'counter-consent' as const, node }, remaining }]
      : [];
    return [...current, ...Object.values(node.outcomes).flatMap((effect) => suspensionContinuations([effect, ...remaining], target))];
  }
  return suspensionContinuations(remaining, target);
}

export function validatePendingChoiceAgainstEffect(pending: import('@guildmaster/game-protocol').PendingEffectChoice, effect: EffectDefinition, state?: GameState, ruleset?: Ruleset): string | undefined {
  const candidates = uniqueContinuations(suspensionContinuations([effect.body], { kind: 'choice', id: pending.choiceId }))
    .filter((candidate): candidate is SuspensionContinuation & { match: Extract<SuspensionMatch, { kind: 'choice' }> } => candidate.match.kind === 'choice');
  const node = candidates[0]?.match.node;
  if (candidates.length !== 1 || !node) return 'Pending choice does not match its registered effect program.';
  if (node.kind === 'choice' && JSON.stringify(node.options) !== JSON.stringify(pending.options)) return 'Pending choice does not match its registered effect program.';
  if (node.kind === 'choose-card') {
    if (!pending.options.length || new Set(pending.options.map(({ id }) => id)).size !== pending.options.length) return 'Dynamic card choice options must be non-empty and unique.';
    const valid = pending.options.every((option) => {
      const expectedContext: EffectContext = {
        ...pending.context,
        cardRefs: { ...(pending.context.cardRefs ?? {}), [node.selectedCardKey]: option.id },
      };
      return JSON.stringify(option.effect) === JSON.stringify(node.effect) && JSON.stringify(option.context) === JSON.stringify(expectedContext);
    });
    const expectedActorId = playerId(node.actor, pending.context);
    const expectedSource = resolveLocation(node.from, pending.context);
    if (!valid || !expectedActorId || expectedActorId !== pending.actorId || !expectedSource || expectedSource.kind !== 'player-zone' || expectedSource.player.kind !== 'player-id' || expectedSource.player.playerId !== expectedActorId || JSON.stringify(pending.source) !== JSON.stringify(expectedSource)) return 'Dynamic card choice actor, source, or options do not match their registered effect program.';
    if (state) {
      if (!ruleset) return 'Dynamic card choice validation requires the active ruleset.';
      const resolved = dynamicCardChoiceCandidates(state, ruleset, node, pending.context);
      if (resolved.status !== 'ready' || JSON.stringify(resolved.cardIds) !== JSON.stringify(pending.options.map(({ id }) => id))) return 'Dynamic card choice candidates do not match the current source zone and predicate.';
    }
  }
  return JSON.stringify(candidates[0]!.remaining) === JSON.stringify(pending.remaining)
    ? undefined
    : 'Pending choice continuation cursor does not match its registered effect program.';
}

export function validatePendingCounterConsentAgainstEffect(pending: import('@guildmaster/game-protocol').PendingCounterConsent, effect: EffectDefinition): string | undefined {
  const candidates = uniqueContinuations(suspensionContinuations([effect.body], { kind: 'counter-consent', id: pending.requestId }))
    .filter((candidate): candidate is SuspensionContinuation & { match: Extract<SuspensionMatch, { kind: 'counter-consent' }> } => candidate.match.kind === 'counter-consent');
  const request = candidates[0]?.match.node;
  if (candidates.length !== 1 || !request || JSON.stringify(request.policy) !== JSON.stringify(pending.policy) || JSON.stringify(request.outcomes) !== JSON.stringify(pending.outcomes)) return 'Pending counter consent does not match its registered effect program.';
  return JSON.stringify(candidates[0]!.remaining) === JSON.stringify(pending.remaining)
    ? undefined
    : 'Pending counter consent continuation cursor does not match its registered effect program.';
}
function counterConsentEvent(state: GameState, events: DomainEvent[], evaluation: CounterConsentEvaluation): void { const types: Record<CounterConsentEvaluation['status'], string> = { requested: 'COUNTER_CONSENT_REQUESTED', pending: 'COUNTER_CONSENT_ACCEPT_RECORDED', accepted: 'COUNTER_CONSENT_ACCEPTED', declined: 'COUNTER_CONSENT_DECLINED', cancelled: 'COUNTER_CONSENT_CANCELLED', expired: 'COUNTER_CONSENT_EXPIRED' }; events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: types[evaluation.status], message: `Counter consent ${evaluation.status}: ${evaluation.reasonCode}.`, moduleId: evaluation.policy.moduleId, payload: { schemaVersion: 1, kind: 'counter-consent', evaluation: structuredClone(evaluation) } }); }

function runNodes(state: GameState, ruleset: Ruleset, nodes: readonly EffectNode[], context: EffectContext, executionId: string, events: DomainEvent[]): EffectExecutionResult {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind === 'sequence') return runNodes(state, ruleset, [...node.effects, ...nodes.slice(index + 1)], context, executionId, events);
    if (node.kind === 'conditional') { const valid = node.condition.kind === 'always' ? node.condition.value : (() => { const id = resolveCardId(node.condition.card, context); const location = resolveLocation(node.condition.location, context); try { return Boolean(id && location && state.cards[id] && isCardAtLocation(state, location, id)); } catch { return false; } })(); const next = valid ? node.whenTrue : node.whenFalse; return runNodes(state, ruleset, [...(next ? [next] : []), ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'choice') { const actorId = playerId(node.actor, context); if (!actorId) return { status: 'failed', events, error: 'Choice actor could not be resolved.' }; state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, actorId, options: node.options, remaining: nodes.slice(index + 1), context }; domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit player choice.'); return { status: 'suspended', events }; }
    if (node.kind === 'choose-card') {
      const resolved = dynamicCardChoiceCandidates(state, ruleset, node, context);
      if (resolved.status !== 'ready') return { status: 'failed', events, error: resolved.error };
      const { actorId, source: visibleSource, cardIds: candidates } = resolved;
      if (!candidates.length) return { status: 'failed', events, error: 'Dynamic card choice has no legal candidates.' };
      const options = candidates.map((cardId) => ({
        id: cardId,
        effect: structuredClone(node.effect),
        context: { ...structuredClone(context), cardRefs: { ...(context.cardRefs ?? {}), [node.selectedCardKey]: cardId } },
      }));
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, actorId, options, remaining: nodes.slice(index + 1), context: structuredClone(context), source: visibleSource };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit card choice.');
      return { status: 'suspended', events };
    }
    if (node.kind === 'random') { if (!node.outcomes.length) return { status: 'failed', events, error: 'Random effect has no outcomes.' }; const outcome = node.outcomes[Math.floor(nextRandom(state) * node.outcomes.length)]!; domainEvent(state, events, 'EFFECT_RANDOM_RESOLVED', `Deterministic random outcome: ${outcome.id}.`); return runNodes(state, ruleset, [outcome.effect, ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'roll-die') { const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }; const roll = evaluateDiceRoll(state, ruleset, { schemaVersion: 1, moduleId: node.moduleId, diceId: node.diceId, randomValue: nextRandom(state), registry }); if (roll.status !== 'ready') return { status: 'failed', events, error: roll.error }; const outcome = node.outcomes.find(({ face }) => face === roll.evaluation.face); const die = ruleset.modules.find(({ id }) => id === node.moduleId)?.diceDefinitions?.find(({ diceId }) => diceId === node.diceId); if (!die || node.outcomes.length !== die.sides || !Array.from({ length: die.sides }, (_, index) => index + 1).every((face) => node.outcomes.some((outcome) => outcome.face === face))) return { status: 'failed', events, error: 'Dice outcomes must cover each registered face exactly once.' }; events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'DIE_ROLLED', message: `Rolled ${roll.evaluation.face} on ${node.diceId}.`, moduleId: node.moduleId, payload: { schemaVersion: 1, kind: 'dice-roll', evaluation: roll.evaluation } }); return runNodes(state, ruleset, [outcome!.effect, ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'request-counter-consent') { const ownerId = playerId(node.counterOwner, context); if (!ownerId) return { status: 'failed', events, error: 'Counter consent owner could not be resolved.' }; const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }; const result = evaluateCounterConsent(state, ruleset, { schemaVersion: 1, action: 'request', actorId: context.controllerId, requestId: node.requestId, executionId, counterOwnerId: ownerId, policy: node.policy, registry }); if (result.status !== 'ready') return { status: 'failed', events, error: `${result.reason}: ${result.error}` }; counterConsentEvent(state, events, result.evaluation); if (result.evaluation.status === 'accepted') { const policy = ruleset.modules.find(({ id }) => id === node.policy.moduleId)?.counterConsentPolicies?.find(({ policyId }) => policyId === node.policy.policyId); const counter = state.players.find(({ id }) => id === ownerId)?.counters.find(({ resourceId }) => resourceId === policy?.resourceId); if (!counter) return { status: 'failed', events, error: 'Counter consent target disappeared.' }; counter.visibility = 'public'; return runNodes(state, ruleset, [node.outcomes.accepted, ...nodes.slice(index + 1)], context, executionId, events); } state.effectState.pendingCounterConsent = { schemaVersion: 1, executionId, requestId: node.requestId, policy: structuredClone(node.policy), counterOwnerId: ownerId, requesterId: context.controllerId, requiredActorIds: [...result.evaluation.requiredActorIds], acceptedActorIds: [], status: 'pending', outcomes: structuredClone(node.outcomes), remaining: nodes.slice(index + 1), context: structuredClone(context), registry }; return { status: 'suspended', events }; }
    if (node.kind === 'grant-combat-reward') { const recipient = playerId(node.recipient, context); if (!recipient) return { status: 'failed', events, error: 'Combat reward recipient could not be resolved.' }; const rewards: EffectNode[] = node.rewards.map((reward) => reward.kind === 'draw' ? { kind: 'draw', player: { kind: 'player-id', playerId: recipient }, count: reward.count } : reward.kind === 'purchase-bonus' ? { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'player-id', playerId: recipient } }, amount: reward.amount } : reward.kind === 'combat-bonus' ? { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'player-id', playerId: recipient } }, amount: reward.amount } : { kind: 'modify-value', target: { kind: 'player-counter', player: { kind: 'player-id', playerId: recipient }, resourceId: reward.resourceId }, amount: reward.amount }); const result = runNodes(state, ruleset, rewards, context, executionId, events); if (result.status !== 'completed') return result; domainEvent(state, events, 'COMBAT_REWARD_GRANTED', 'Effect granted a data-driven combat reward.'); continue; }
    if (node.kind === 'draw') { const id = playerId(node.player, context); if (!id) return { status: 'failed', events, error: 'Draw player could not be resolved.' }; drawCards(state, id, node.count, events); continue; }
    if (node.kind === 'refresh-supply-row') { const refresh = evaluateSupplyRowRefresh(state, ruleset, node.refreshPolicyId); if (refresh.status !== 'ready') return { status: refresh.status, events, error: refresh.error }; const evaluation = refresh.evaluation; const policy = ruleset.modules.flatMap((module) => module.supplyRowRefreshPolicies ?? []).find((entry) => entry.refreshPolicyId === node.refreshPolicyId)!; const config = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.moduleId === evaluation.configuration.moduleId && entry.configurationId === evaluation.configuration.configurationId)!; const row = getZone(state, evaluation.targetRowZoneId).cardIds; const destination = getZone(state, evaluation.destinationZoneId).cardIds; const moved = policy.ordering.startsWith('reverse') ? [...evaluation.rowCardIds].reverse() : evaluation.rowCardIds; for (const cardId of evaluation.rowCardIds) { const index = row.indexOf(cardId); if (index < 0) return { status: 'failed', events, error: 'Refresh row changed during evaluation.' }; row.splice(index, 1); } if (policy.ordering.endsWith('top')) destination.push(...moved); else destination.unshift(...moved); if (policy.refill) refillSupplyConfiguration(state, ruleset, config, events); domainEvent(state, events, 'SUPPLY_ROW_REFRESHED', `Supply row refreshed by ${node.refreshPolicyId}.`); continue; }
    if (node.kind === 'modify-value') { const id = playerId(node.target.player, context); if (!id) return { status: 'failed', events, error: 'Value target player could not be resolved.' }; const player = getPlayer(state, id); if (node.target.kind === 'turn-purchase-bonus') player.turnPurchaseBonus += node.amount; else if (node.target.kind === 'turn-combat-bonus') player.turnCombatBonus += node.amount; else { const resourceId = node.target.resourceId; const counter = player.counters.find((item) => item.resourceId === resourceId); if (counter) counter.amount += node.amount; else player.counters.push({ resourceId, amount: node.amount, visibility: 'ownerOnly' }); } domainEvent(state, events, 'EFFECT_VALUE_MODIFIED', 'Effect modified a serializable value.'); continue; }
    if (node.kind === 'create-enemy-encounter' || node.kind === 'create-enemy-target' || node.kind === 'attach-card-to-enemy-target' || node.kind === 'damage-enemy-target' || node.kind === 'defeat-enemy-target' || node.kind === 'remove-enemy-target' || node.kind === 'finish-enemy-encounter') { const result = node.kind === 'create-enemy-encounter' ? createEnemyEncounter(state, ruleset, node, events) : node.kind === 'create-enemy-target' ? createEnemyTarget(state, ruleset, node, context, events) : node.kind === 'attach-card-to-enemy-target' ? attachCardToEnemyTarget(state, ruleset, node, context, events) : node.kind === 'damage-enemy-target' ? damageEnemyTarget(state, ruleset, node, events) : node.kind === 'defeat-enemy-target' ? defeatEnemyTarget(state, ruleset, node, events) : node.kind === 'remove-enemy-target' ? removeEnemyTarget(state, ruleset, node, events) : finishEnemyEncounter(state, ruleset, node, events); if (!result.ok) return { status: 'failed', events, error: result.error }; continue; }
    const cardId = resolveCardId(node.card, context); if (!cardId) return { status: 'failed', events, error: 'Effect card reference could not be resolved.' };
    const to = node.kind === 'move-card' ? node.to : node.kind === 'discard-card' ? { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const : { kind: 'removed' } as const;
    const result = moveCard(state, { cardInstanceId: cardId, from: node.from, to, actorId: context.controllerId, context, registry: ruleset.registry, ...(node.kind === 'move-card' && node.position !== undefined ? { position: node.position } : {}), ...(node.permission !== undefined ? { permission: node.permission } : {}), ...(node.kind === 'move-card' && node.transferOwnership !== undefined ? { transferOwnership: node.transferOwnership } : {}) });
    if (!result.ok) return { status: 'failed', events, error: `${result.code}: ${result.message}` }; domainEvent(state, events, 'CARD_MOVED', 'Effect moved a card.');
  }
  return { status: 'completed', events };
}
export function executeEffect(state: GameState, ruleset: Ruleset, effect: EffectDefinition, context: EffectContext, executionId: string): EffectExecutionResult { const events: DomainEvent[] = []; const validationErrors = validateEffectDefinition(effect); if (validationErrors.length) return { status: 'failed', events, error: `Invalid effect definition: ${validationErrors.join(' ')}` }; const next = structuredClone(state); if (next.effectState.pendingChoice || next.effectState.pendingCounterConsent) return { status: 'failed', events, error: 'Another effect suspension is pending.' }; domainEvent(next, events, 'EFFECT_STARTED', `Effect ${effect.effectId} started.`); const result = runNodes(next, ruleset, [effect.body], context, executionId, events); if (result.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Effect ${effect.effectId} completed.`); if (result.status === 'completed' || result.status === 'suspended') commitState(state, next); return result; }
export function resumeEffectChoice(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): EffectExecutionResult {
  const next = structuredClone(state); const events: DomainEvent[] = []; const pending = next.effectState.pendingChoice;
  if (!pending || pending.executionId !== executionId || pending.choiceId !== choiceId || pending.actorId !== actorId) return { status: 'failed', events, error: 'No matching pending effect choice.' };
  const option = pending.options.find((entry) => entry.id === optionId); if (!option) return { status: 'failed', events, error: 'Invalid pending effect choice option.' };
  delete next.effectState.pendingChoice; const result = runNodes(next, ruleset, [option.effect, ...pending.remaining], option.context ?? pending.context, executionId, events); if (result.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Effect choice ${choiceId} completed.`); if (result.status === 'completed' || result.status === 'suspended') commitState(state, next); return result;
}
export function resumeEffectCounterConsent(state: GameState, ruleset: Ruleset, actorId: string, requestId: string, action: Exclude<CounterConsentAction, 'request'>): EffectExecutionResult {
  const next = structuredClone(state); const events: DomainEvent[] = []; const pending = next.effectState.pendingCounterConsent;
  if (!pending) return { status: 'failed', events, error: 'No counter consent request is pending.' };
  const result = evaluateCounterConsent(next, ruleset, { schemaVersion: 1, action, actorId, requestId, registry: structuredClone(pending.registry) });
  if (result.status !== 'ready') return { status: 'failed', events, error: `${result.reason}: ${result.error}` };
  counterConsentEvent(next, events, result.evaluation);
  if (result.evaluation.status === 'pending') { pending.acceptedActorIds = [...result.evaluation.acceptedActorIds]; commitState(state, next); return { status: 'suspended', events }; }
  if (result.evaluation.status === 'requested') return { status: 'failed', events: [], error: 'A pending counter consent action cannot create a new request.' };
  delete next.effectState.pendingCounterConsent;
  if (result.evaluation.status === 'accepted') { const policy = ruleset.modules.find(({ id }) => id === pending.policy.moduleId)?.counterConsentPolicies?.find(({ policyId }) => policyId === pending.policy.policyId); const counter = next.players.find(({ id }) => id === pending.counterOwnerId)?.counters.find(({ resourceId }) => resourceId === policy?.resourceId); if (!counter) return { status: 'failed', events, error: 'Counter consent target disappeared.' }; counter.visibility = 'public'; }
  const outcome = pending.outcomes[result.evaluation.status];
  const resumed = runNodes(next, ruleset, [outcome, ...pending.remaining], pending.context, pending.executionId, events);
  if (resumed.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Counter consent ${requestId} completed.`);
  if (resumed.status === 'completed' || resumed.status === 'suspended') commitState(state, next);
  return resumed;
}
