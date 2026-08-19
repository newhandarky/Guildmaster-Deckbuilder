import { validateEffectCardPredicate, validateEffectDefinition, type CounterConsentAction, type CounterConsentEvaluation, type DomainEvent, type EffectContext, type EffectDefinition, type EffectNode, type GameState } from '@guildmaster/game-protocol';
import { drawCards } from '../engine/draw.js';
import { getDefinition, getPlayer } from '../model/factories.js';
import { nextRandom, shuffle } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { isCardAtLocation, moveCard, resolveCardId, resolveLocation } from './movement.js';
import { evaluateSupplyRowRefresh } from '../rules/supply-row-refresh-evaluator.js';
import { refillSupplyConfiguration } from '../engine/supply.js';
import { getZone } from '../model/zones.js';
import { attachCardToEnemyTarget, createEnemyEncounter, createEnemyTarget, damageEnemyTarget, defeatEnemyTarget, finishEnemyEncounter, removeEnemyTarget } from '../engine/encounter-resolution.js';
import { evaluateDiceRoll } from '../rules/dice-evaluator.js';
import { evaluateCounterConsent } from '../rules/counter-consent-evaluator.js';
import { evaluateTeamCapacityEnforcement } from '../rules/team-capacity-enforcement-evaluator.js';
import { discardDestination, pushDiscard } from '../rules/discard-redirect-evaluator.js';
import { attachedCardIds } from '../model/attachments.js';
import { attachTargets } from '../engine/target-supply.js';
import { dynamicCardChoiceCandidates, matchesCardPredicate, repeatedItemQueue, resolvedDeckOrder, resolvedPartyOrder, resolvedRepeatDiscard, resolveEffectPlayerId as playerId, sharedRowRefreshOptions } from './effect-choice-resolution.js';
export { inspectEffectPreviewUncertainty, type EffectPreviewUncertainty } from './effect-preview.js';
export { validatePendingChoiceAgainstEffect, validatePendingCounterConsentAgainstEffect } from './effect-program-validation.js';

export type EffectOrderResolution = { status: 'ready'; orderedIds: readonly string[] } | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED' };
/** Never infer trigger/replacement ordering from array order or active player. */
export function resolveEffectOrder(entries: readonly { id: string; priority?: number }[], policy?: 'explicit-priority'): EffectOrderResolution {
  if (entries.length < 2) return { status: 'ready', orderedIds: entries.map((entry) => entry.id) };
  if (policy !== 'explicit-priority' || entries.some((entry) => entry.priority === undefined)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  const ordered = [...entries].sort((left, right) => left.priority! - right.priority!); if (ordered.some((entry, index) => index > 0 && entry.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  return { status: 'ready', orderedIds: ordered.map((entry) => entry.id) };
}

export type EffectExecutionResult = { status: 'completed' | 'suspended' | 'failed' | 'unsupported'; events: DomainEvent[]; error?: string };
const domainEvent = (state: GameState, events: DomainEvent[], type: string, message: string, details?: Pick<DomainEvent, 'moduleId' | 'payload'>) => events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, ...details });
function numberValue(value: import('@guildmaster/game-protocol').EffectNumberValue, state: GameState, ruleset: Ruleset, context: EffectContext): number | undefined {
  if (typeof value === 'number') return value;
  if (value.kind === 'player-count') return state.players.length;
  if (value.kind === 'card-stat') {
    const cardId = resolveCardId(value.card, context);
    const definition = cardId && state.cards[cardId] ? getDefinition(ruleset.registry, state, cardId) : undefined;
    return definition?.[value.stat];
  }
  const ownerId = playerId(value.player, context);
  if (!ownerId) return undefined;
  if (value.kind === 'party-card-count') return getPlayer(state, ownerId).party.length;
  const distinctTags = new Set(getPlayer(state, ownerId).party.flatMap(({ adventurerId }) =>
    (getDefinition(ruleset.registry, state, adventurerId).tags ?? [])
      .filter((tag) => tag.startsWith(value.tagPrefix) && tag.length > value.tagPrefix.length),
  ));
  return distinctTags.size;
}
function commitState(target: GameState, source: GameState): void { Object.assign(target, source); }
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalJson(entry)]));
}
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
function drawEffectCards(state: GameState, playerId: string, count: number, events: DomainEvent[]): void {
  const before = getPlayer(state, playerId).hand.length;
  drawCards(state, playerId, count, events);
  const actual = getPlayer(state, playerId).hand.length - before;
  if (actual > 0 && state.turnFacts?.playerId === playerId) state.turnFacts.extraCardsDrawn += actual;
}
function containsCombatFailure(node: EffectNode): boolean {
  if (node.kind === 'mark-combat-failed') return true;
  if (node.kind === 'sequence') return node.effects.some(containsCombatFailure);
  if (node.kind === 'conditional') return containsCombatFailure(node.whenTrue) || Boolean(node.whenFalse && containsCombatFailure(node.whenFalse));
  if (node.kind === 'choice') return node.options.some(({ effect }) => containsCombatFailure(effect));
  if (node.kind === 'choose-card') return containsCombatFailure(node.effect) || Boolean(node.zeroCandidateEffect && containsCombatFailure(node.zeroCandidateEffect));
  if (node.kind === 'random' || node.kind === 'roll-die') return node.outcomes.some(({ effect }) => containsCombatFailure(effect));
  if (node.kind === 'request-counter-consent') return Object.values(node.outcomes).some(containsCombatFailure);
  return false;
}

/** Owner-authoritative CPU hint for a reward program whose first operation is an unpaid combat-failure gate. */
export function effectStartsWithUnpayableCombatFailureGate(state: GameState, ruleset: Ruleset, effect: EffectDefinition, context: EffectContext): boolean {
  const node = effect.body;
  if (node.kind !== 'choose-card' || !node.zeroCandidateEffect || !containsCombatFailure(node.zeroCandidateEffect)) return false;
  const candidates = dynamicCardChoiceCandidates(state, ruleset, node, context);
  return candidates.status === 'ready' && candidates.candidates.length === 0;
}
function counterConsentEvent(state: GameState, events: DomainEvent[], evaluation: CounterConsentEvaluation): void { const types: Record<CounterConsentEvaluation['status'], string> = { requested: 'COUNTER_CONSENT_REQUESTED', pending: 'COUNTER_CONSENT_ACCEPT_RECORDED', accepted: 'COUNTER_CONSENT_ACCEPTED', declined: 'COUNTER_CONSENT_DECLINED', cancelled: 'COUNTER_CONSENT_CANCELLED', expired: 'COUNTER_CONSENT_EXPIRED' }; events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: types[evaluation.status], message: `Counter consent ${evaluation.status}: ${evaluation.reasonCode}.`, moduleId: evaluation.policy.moduleId, payload: { schemaVersion: 1, kind: 'counter-consent', evaluation: structuredClone(evaluation) } }); }

function runNodes(state: GameState, ruleset: Ruleset, nodes: readonly EffectNode[], context: EffectContext, executionId: string, events: DomainEvent[]): EffectExecutionResult {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind === 'sequence') return runNodes(state, ruleset, [...node.effects, ...nodes.slice(index + 1)], context, executionId, events);
    if (node.kind === 'conditional') { const condition = node.condition; const valid = condition.kind === 'always' ? condition.value : condition.kind === 'definition-in-zone' ? Boolean(state.zones[condition.zoneId]?.cardIds.some((cardId) => state.cards[cardId]?.definitionId === condition.definitionId)) : (() => { const id = resolveCardId(condition.card, context); const location = resolveLocation(condition.location, context); try { return Boolean(id && location && state.cards[id] && isCardAtLocation(state, location, id)); } catch { return false; } })(); const next = valid ? node.whenTrue : node.whenFalse; return runNodes(state, ruleset, [...(next ? [next] : []), ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'choice') { const actorId = playerId(node.actor, context); if (!actorId) return { status: 'failed', events, error: 'Choice actor could not be resolved.' }; state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}), actorId, options: node.options, remaining: nodes.slice(index + 1), context }; domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit player choice.'); return { status: 'suspended', events }; }
    if (node.kind === 'choose-card') {
      const resolved = dynamicCardChoiceCandidates(state, ruleset, node, context);
      if (resolved.status !== 'ready') return { status: 'failed', events, error: resolved.error };
      const { actorId, source: visibleSource, candidates } = resolved;
      if (!candidates.length && node.zeroCandidateBehavior === 'skip') {
        domainEvent(state, events, 'EFFECT_CHOICE_SKIPPED', 'Effect card choice had no legal candidates.');
        continue;
      }
      if (!candidates.length && node.zeroCandidateEffect) {
        domainEvent(state, events, 'EFFECT_ZERO_CANDIDATE_RESOLVED', 'Effect card choice resolved its zero-candidate outcome.');
        return runNodes(state, ruleset, [node.zeroCandidateEffect, ...nodes.slice(index + 1)], context, executionId, events);
      }
      if (!candidates.length && !node.skipOptionId) return { status: 'failed', events, error: 'Dynamic card choice has no legal candidates.' };
      if (node.skipOptionId && candidates.some(({ cardId }) => cardId === node.skipOptionId)) return { status: 'failed', events, error: 'Dynamic card choice skip option collides with a candidate card ID.' };
      const options: { id: string; effect: EffectNode; context?: EffectContext }[] = candidates.map(({ cardId, location }) => ({
        id: cardId,
        effect: structuredClone(node.effect),
        context: {
          ...structuredClone(context),
          cardRefs: { ...(context.cardRefs ?? {}), [node.selectedCardKey]: cardId },
          ...(node.selectedLocationKey ? { locationRefs: { ...(context.locationRefs ?? {}), [node.selectedLocationKey]: structuredClone(location) } } : {}),
        },
      }));
      if (node.skipOptionId) options.push({
        id: node.skipOptionId,
        effect: { kind: 'conditional', condition: { kind: 'always', value: false }, whenTrue: structuredClone(node.effect) },
        context: structuredClone(context),
      });
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, ...(node.decisionKind ? { decisionKind: node.decisionKind } : {}), actorId, options, remaining: nodes.slice(index + 1), context: structuredClone(context), source: visibleSource };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit card choice.');
      return { status: 'suspended', events };
    }
    if (node.kind === 'choose-order-player-deck-top') {
      const resolved = resolvedDeckOrder(state, node, context);
      if (resolved.status === 'failed') return { status: 'failed', events, error: resolved.error };
      if (resolved.status === 'empty') { domainEvent(state, events, 'EFFECT_ORDER_SKIPPED', 'Deck ordering had no cards to inspect.'); continue; }
      const options = resolved.resolutions.map(({ optionId }) => ({ id: optionId, effect: { kind: 'conditional' as const, condition: { kind: 'always' as const, value: false }, whenTrue: { kind: 'draw' as const, player: { kind: 'controller' as const }, count: 0 } } }));
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.orderId, decisionKind: 'choose-order', actorId: resolved.actorId, options, remaining: nodes.slice(index + 1), context: structuredClone(context), order: { playerId: resolved.targetId, cardIds: resolved.cardIds, mayRemove: node.mayRemove, resolutions: resolved.resolutions } };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit private deck order.');
      return { status: 'suspended', events };
    }
    if (node.kind === 'choose-order-player-party') {
      const resolved = resolvedPartyOrder(state, node, context);
      if (resolved.status === 'failed') return { status: 'failed', events, error: resolved.error };
      if (resolved.status === 'empty') { domainEvent(state, events, 'EFFECT_ORDER_SKIPPED', 'Party ordering had no members.'); continue; }
      const options = resolved.resolutions.map(({ optionId }) => ({ id: optionId, effect: { kind: 'conditional' as const, condition: { kind: 'always' as const, value: false }, whenTrue: { kind: 'draw' as const, player: { kind: 'controller' as const }, count: 0 } } }));
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.orderId, decisionKind: 'choose-order', actorId: resolved.actorId, options, remaining: nodes.slice(index + 1), context: structuredClone(context), order: { kind: 'party', playerId: resolved.targetId, cardIds: resolved.cardIds, mayRemove: false, resolutions: resolved.resolutions } };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit party order.');
      return { status: 'suspended', events };
    }
    if (node.kind === 'repeat-discard-hand-for-combat') {
      const resolved = resolvedRepeatDiscard(state, node, context); if (resolved.status === 'failed') return { status: 'failed', events, error: resolved.error };
      if (resolved.options.length === 1) { domainEvent(state, events, 'EFFECT_CHOICE_SKIPPED', 'Repeated discard had no cards to discard.'); continue; }
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, decisionKind: 'discard-card', actorId: resolved.actorId, options: resolved.options, remaining: nodes.slice(index + 1), context: structuredClone(context), source: resolved.source };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect may discard any number of hand cards.'); return { status: 'suspended', events };
    }
    if (node.kind === 'choose-shared-row-refresh-subset') {
      const resolved = sharedRowRefreshOptions(state, node, context);
      if (resolved.status !== 'ready') return { status: 'failed', events, error: resolved.error };
      state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, decisionKind: 'choose-enemy-target', actorId: resolved.actorId, options: resolved.options, remaining: nodes.slice(index + 1), context: structuredClone(context), source: resolved.source };
      domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect may refresh any subset of the public enemy row.');
      return { status: 'suspended', events };
    }
    if (node.kind === 'random') { if (!node.outcomes.length) return { status: 'failed', events, error: 'Random effect has no outcomes.' }; const outcome = node.outcomes[Math.floor(nextRandom(state) * node.outcomes.length)]!; domainEvent(state, events, 'EFFECT_RANDOM_RESOLVED', `Deterministic random outcome: ${outcome.id}.`); return runNodes(state, ruleset, [outcome.effect, ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'roll-die') { const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }; const roll = evaluateDiceRoll(state, ruleset, { schemaVersion: 1, moduleId: node.moduleId, diceId: node.diceId, randomValue: nextRandom(state), registry }); if (roll.status !== 'ready') return { status: 'failed', events, error: roll.error }; const outcome = node.outcomes.find(({ face }) => face === roll.evaluation.face); const die = ruleset.modules.find(({ id }) => id === node.moduleId)?.diceDefinitions?.find(({ diceId }) => diceId === node.diceId); if (!die || node.outcomes.length !== die.sides || !Array.from({ length: die.sides }, (_, index) => index + 1).every((face) => node.outcomes.some((outcome) => outcome.face === face))) return { status: 'failed', events, error: 'Dice outcomes must cover each registered face exactly once.' }; events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'DIE_ROLLED', message: `Rolled ${roll.evaluation.face} on ${node.diceId}.`, moduleId: node.moduleId, payload: { schemaVersion: 1, kind: 'dice-roll', evaluation: roll.evaluation } }); return runNodes(state, ruleset, [outcome!.effect, ...nodes.slice(index + 1)], context, executionId, events); }
    if (node.kind === 'request-counter-consent') { const ownerId = playerId(node.counterOwner, context); if (!ownerId) return { status: 'failed', events, error: 'Counter consent owner could not be resolved.' }; const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) }; const result = evaluateCounterConsent(state, ruleset, { schemaVersion: 1, action: 'request', actorId: context.controllerId, requestId: node.requestId, executionId, counterOwnerId: ownerId, policy: node.policy, registry }); if (result.status !== 'ready') return { status: 'failed', events, error: `${result.reason}: ${result.error}` }; counterConsentEvent(state, events, result.evaluation); if (result.evaluation.status === 'accepted') { const policy = ruleset.modules.find(({ id }) => id === node.policy.moduleId)?.counterConsentPolicies?.find(({ policyId }) => policyId === node.policy.policyId); const counter = state.players.find(({ id }) => id === ownerId)?.counters.find(({ resourceId }) => resourceId === policy?.resourceId); if (!counter) return { status: 'failed', events, error: 'Counter consent target disappeared.' }; counter.visibility = 'public'; return runNodes(state, ruleset, [node.outcomes.accepted, ...nodes.slice(index + 1)], context, executionId, events); } state.effectState.pendingCounterConsent = { schemaVersion: 1, executionId, requestId: node.requestId, policy: structuredClone(node.policy), counterOwnerId: ownerId, requesterId: context.controllerId, requiredActorIds: [...result.evaluation.requiredActorIds], acceptedActorIds: [], status: 'pending', outcomes: structuredClone(node.outcomes), remaining: nodes.slice(index + 1), context: structuredClone(context), registry }; return { status: 'suspended', events }; }
    if (node.kind === 'grant-combat-reward') { const recipient = playerId(node.recipient, context); if (!recipient) return { status: 'failed', events, error: 'Combat reward recipient could not be resolved.' }; const rewards: EffectNode[] = node.rewards.map((reward) => reward.kind === 'draw' ? { kind: 'draw', player: { kind: 'player-id', playerId: recipient }, count: reward.count } : reward.kind === 'purchase-bonus' ? { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'player-id', playerId: recipient } }, amount: reward.amount } : reward.kind === 'combat-bonus' ? { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'player-id', playerId: recipient } }, amount: reward.amount } : { kind: 'modify-value', target: { kind: 'player-counter', player: { kind: 'player-id', playerId: recipient }, resourceId: reward.resourceId }, amount: reward.amount }); const result = runNodes(state, ruleset, rewards, context, executionId, events); if (result.status !== 'completed') return result; domainEvent(state, events, 'COMBAT_REWARD_GRANTED', 'Effect granted a data-driven combat reward.'); continue; }
    if (node.kind === 'draw') { const id = playerId(node.player, context); const count = numberValue(node.count, state, ruleset, context); if (!id || count === undefined) return { status: 'failed', events, error: 'Draw player or count could not be resolved.' }; drawEffectCards(state, id, count, events); continue; }
    if (node.kind === 'draw-shared-deck') {
      const id = playerId(node.player, context);
      const source = state.zones[node.sourceZoneId];
      if (!id) return { status: 'failed', events, error: 'Shared-deck draw player could not be resolved.' };
      if (!source || source.kind !== 'orderedDeck') return { status: 'failed', events, error: 'Shared-deck draw source must be an ordered deck.' };
      const recipient = getPlayer(state, id);
      for (let remaining = node.count; remaining > 0; remaining -= 1) {
        const cardId = source.cardIds.pop();
        if (!cardId) break;
        recipient[node.destination].push(cardId);
        state.cards[cardId]!.ownerId = id;
        domainEvent(state, events, 'SHARED_DECK_CARD_DRAWN', `${recipient.name} 從公共牌庫取得一張牌。`);
      }
      continue;
    }
    if (node.kind === 'discard-hand-and-draw') {
      const id = playerId(node.player, context);
      if (!id) return { status: 'failed', events, error: 'Discard-and-draw player could not be resolved.' };
      const target = getPlayer(state, id);
      const count = target.hand.length;
      for (const cardId of target.hand.splice(0)) pushDiscard(state, ruleset, id, cardId);
      domainEvent(state, events, 'HAND_DISCARDED', `${target.name} 棄掉全部手牌。`);
      drawEffectCards(state, id, count, events);
      continue;
    }
    if (node.kind === 'discard-party-and-hand') {
      const id = playerId(node.player, context); if (!id) return { status: 'failed', events, error: 'Party-and-hand discard player could not be resolved.' };
      const target = getPlayer(state, id); const partyCards = target.party.flatMap((slot) => [slot.adventurerId, ...attachedCardIds(slot)]);
      for (const cardId of [...target.hand.splice(0), ...partyCards]) pushDiscard(state, ruleset, id, cardId); target.party = [];
      domainEvent(state, events, 'PARTY_AND_HAND_DISCARDED', `${target.name} 棄掉全部手牌與隊伍。`); continue;
    }
    if (node.kind === 'discard-first-party-member') {
      const id = playerId(node.player, context);
      if (!id) return { status: 'failed', events, error: 'First-party discard player could not be resolved.' };
      const target = getPlayer(state, id);
      const slot = target.party.shift();
      if (!slot) return { status: 'failed', events, error: 'First-party discard requires a party member.' };
      for (const cardId of [slot.adventurerId, ...attachedCardIds(slot)]) pushDiscard(state, ruleset, id, cardId);
      domainEvent(state, events, 'PARTY_MEMBER_DISCARDED', `${target.name} 棄掉隊伍第一位冒險者。`);
      continue;
    }
    if (node.kind === 'assert-turn-fact-at-most') {
      const id = playerId(node.player, context); const facts = state.turnFacts;
      if (!id || !facts || facts.playerId !== id || facts[node.fact] > node.amount) return { status: 'failed', events, error: `Turn fact assertion failed: ${node.reasonCode}.` };
      continue;
    }
    if (node.kind === 'record-turn-effect-use') {
      const id = playerId(node.player, context); const facts = state.turnFacts;
      if (!id || !facts || facts.playerId !== id) return { status: 'failed', events, error: 'Turn effect use requires the active player ledger.' };
      const uses = facts.effectUses ?? (facts.effectUses = {}); const current = uses[node.usageId] ?? 0;
      if (current >= node.maxUses) return { status: 'failed', events, error: `Turn effect use limit reached: ${node.usageId}.` };
      uses[node.usageId] = current + 1; domainEvent(state, events, 'TURN_EFFECT_USE_RECORDED', `Recorded turn effect use ${node.usageId}.`); continue;
    }
    if (node.kind === 'skip-combat-this-turn') {
      const id = playerId(node.player, context); const facts = state.turnFacts;
      if (!id || !facts || facts.playerId !== id) return { status: 'failed', events, error: 'Combat skip requires the active player ledger.' };
      facts.combatSkipped = true; domainEvent(state, events, 'COMBAT_SKIP_SCHEDULED', `${getPlayer(state, id).name} 本回合跳過討伐階段。`); continue;
    }
    if (node.kind === 'add-turn-enemy-card-purchase-bonus') {
      const id = playerId(node.player, context); const facts = state.turnFacts;
      if (!id || !facts || facts.playerId !== id) return { status: 'failed', events, error: 'Enemy-card purchase bonus requires the active player ledger.' };
      facts.enemyCardPurchaseBonusPerCard = (facts.enemyCardPurchaseBonusPerCard ?? 0) + node.amount; domainEvent(state, events, 'TURN_ENEMY_PURCHASE_BONUS_ADDED', `${getPlayer(state, id).name} 的敵人卡購買力暫時增加。`); continue;
    }
    if (node.kind === 'set-turn-card-combat-multiplier') {
      const id = playerId(node.player, context); const facts = state.turnFacts;
      if (!id || !facts || facts.playerId !== id || !ruleset.registry.definitions[node.definitionId]) return { status: 'failed', events, error: 'Turn combat multiplier requires an active player and known definition.' };
      const values = facts.partyCombatMultipliers ?? (facts.partyCombatMultipliers = []);
      const index = values.findIndex(({ definitionId }) => definitionId === node.definitionId);
      const value = { definitionId: node.definitionId, numerator: node.numerator, denominator: node.denominator, rounding: node.rounding };
      if (index >= 0) values[index] = value; else values.push(value);
      domainEvent(state, events, 'TURN_PARTY_COMBAT_MULTIPLIER_SET', `Set a turn combat multiplier for ${node.definitionId}.`); continue;
    }
    if (node.kind === 'repeat-item-use-effect') {
      const id = playerId(node.player, context); const cardId = resolveCardId(node.card, context);
      const target = id ? state.players.find(({ id: playerIdValue }) => playerIdValue === id) : undefined;
      const definition = cardId ? ruleset.registry.definitions[state.cards[cardId]?.definitionId ?? ''] : undefined;
      const repeated = repeatedItemQueue(state, ruleset, node, context);
      if (!id || !cardId || !target || !definition?.useEffect || definition.type !== 'item' || definition.tags?.includes('playtest:effects-disabled') || !repeated) return { status: 'failed', events, error: 'Repeated item use requires an enabled item with a registered use effect.' };
      const moved = moveCard(state, { cardInstanceId: cardId, from: { kind: 'player-zone', player: { kind: 'player-id', playerId: id }, zone: 'hand' }, to: { kind: 'player-zone', player: { kind: 'player-id', playerId: id }, zone: 'playArea' }, actorId: context.controllerId, context, registry: ruleset.registry });
      if (!moved.ok) return { status: 'failed', events, error: `${moved.code}: ${moved.message}` };
      const ledger = state.turnFacts;
      if (!ledger || ledger.playerId !== id) return { status: 'failed', events, error: 'Repeated item use requires the active player ledger.' };
      ledger.itemsUsed += 1; ledger.actionPhaseItemsUsed = (ledger.actionPhaseItemsUsed ?? 0) + 1;
      domainEvent(state, events, 'ITEM_USED', `${target.name} 使用一張道具，其效果執行 ${node.times} 次。`);
      return runNodes(state, ruleset, [...repeated, ...nodes.slice(index + 1)], context, executionId, events);
    }
    if (node.kind === 'reveal-player-deck-until') {
      const id = playerId(node.player, context);
      if (!id) return { status: 'failed', events, error: 'Deck reveal player could not be resolved.' };
      const predicateErrors = validateEffectCardPredicate(node.predicate);
      if (predicateErrors.length) return { status: 'failed', events, error: `Deck reveal predicate is invalid: ${predicateErrors.join(' ')}` };
      const target = getPlayer(state, id);
      while (true) {
        if (!target.drawPile.length && target.discardPile.length) {
          target.drawPile = shuffle(state, target.discardPile);
          target.discardPile = [];
          domainEvent(state, events, 'DRAW_PILE_REBUILT', `${target.name} 洗混棄牌堆重建牌庫。`);
        }
        const cardId = target.drawPile.pop();
        if (!cardId) break;
        domainEvent(state, events, 'CARD_REVEALED', `${target.name} 公開展示牌庫頂卡牌。`);
        if (!matchesCardPredicate(state, ruleset, cardId, node.predicate)) {
          target.drawPile.push(cardId);
          break;
        }
        target.hand.push(cardId);
        domainEvent(state, events, 'CARD_DRAWN', `${target.name} 將展示卡加入手牌。`);
      }
      continue;
    }
    if (node.kind === 'reveal-player-deck-top') {
      const id = playerId(node.player, context);
      if (!id) return { status: 'failed', events, error: 'Deck-top reveal player could not be resolved.' };
      const predicateErrors = validateEffectCardPredicate(node.predicate);
      if (predicateErrors.length) return { status: 'failed', events, error: `Deck-top reveal predicate is invalid: ${predicateErrors.join(' ')}` };
      const target = getPlayer(state, id);
      if (!target.drawPile.length && target.discardPile.length) {
        target.drawPile = shuffle(state, target.discardPile);
        target.discardPile = [];
        domainEvent(state, events, 'DRAW_PILE_REBUILT', `${target.name} 洗混棄牌堆重建牌庫。`);
      }
      const cardId = target.drawPile.at(-1);
      if (cardId && matchesCardPredicate(state, ruleset, cardId, node.predicate)) {
        target.drawPile.pop(); target.hand.push(cardId);
        domainEvent(state, events, 'CARD_REVEALED', `${target.name} 公開展示符合條件的牌庫頂卡牌。`);
        domainEvent(state, events, 'CARD_DRAWN', `${target.name} 將展示卡加入手牌。`);
        if (state.turnFacts?.playerId === id) state.turnFacts.extraCardsDrawn += 1;
      } else domainEvent(state, events, 'CARD_INSPECTED_PRIVATELY', `${target.name} 私下查看牌庫頂卡牌。`);
      continue;
    }
    if (node.kind === 'reveal-shared-deck-to-zone') {
      const source = state.zones[node.sourceZoneId]; const destination = state.zones[node.destinationZoneId];
      const count = numberValue(node.count, state, ruleset, context);
      if (!source || source.kind !== 'orderedDeck' || !destination || destination.visibility !== 'public' || destination.kind !== 'moduleArea' || count === undefined) return { status: 'failed', events, error: 'Shared-deck reveal requires an ordered source, empty public module area, and valid count.' };
      if (destination.cardIds.length) return { status: 'failed', events, error: 'Shared-deck reveal destination must be empty.' };
      for (let remaining = count; remaining > 0; remaining -= 1) {
        const cardId = source.cardIds.pop(); if (!cardId) break;
        destination.cardIds.push(cardId); domainEvent(state, events, 'CARD_REVEALED', '公共牌庫翻開一張牌供輪選。');
      }
      continue;
    }
    if (node.kind === 'add-temporary-target-combat-modifier') {
      const targetCardId = resolveCardId(node.targetCard, context);
      const target = targetCardId ? Object.values(state.enemyTargets).find((candidate) => candidate.cardInstanceId === targetCardId && candidate.status === 'available') : undefined;
      if (!targetCardId || !target || !ruleset.modules.some(({ id }) => id === node.moduleId)) return { status: 'failed', events, error: 'Temporary target modifier requires an available target card and known Rules Module.' };
      const modifiers = state.temporaryTargetModifiers ?? (state.temporaryTargetModifiers = []);
      const modifierId = `${node.moduleId}:${node.modifierId}:${context.controllerId}:${state.revision}:${modifiers.length + 1}`;
      modifiers.push({ modifierId, moduleId: node.moduleId, targetCardId, amount: node.amount, expiresAtTurnEndPlayerId: context.controllerId });
      domainEvent(state, events, 'TEMPORARY_TARGET_MODIFIER_ADDED', `敵人戰力暫時修正 ${node.amount}。`, { moduleId: node.moduleId });
      continue;
    }
    if (node.kind === 'mark-combat-failed') { domainEvent(state, events, 'COMBAT_FAILED', `Combat failed: ${node.reasonCode}.`, { payload: { schemaVersion: 1, kind: 'combat-failure', reasonCode: node.reasonCode } }); continue; }
    if (node.kind === 'refresh-supply-row') { const refresh = evaluateSupplyRowRefresh(state, ruleset, node.refreshPolicyId); if (refresh.status !== 'ready') return { status: refresh.status, events, error: refresh.error }; const evaluation = refresh.evaluation; const policy = ruleset.modules.flatMap((module) => module.supplyRowRefreshPolicies ?? []).find((entry) => entry.refreshPolicyId === node.refreshPolicyId)!; const config = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.moduleId === evaluation.configuration.moduleId && entry.configurationId === evaluation.configuration.configurationId)!; const row = getZone(state, evaluation.targetRowZoneId).cardIds; const destination = getZone(state, evaluation.destinationZoneId).cardIds; const moved = policy.ordering.startsWith('reverse') ? [...evaluation.rowCardIds].reverse() : evaluation.rowCardIds; for (const cardId of evaluation.rowCardIds) { const index = row.indexOf(cardId); if (index < 0) return { status: 'failed', events, error: 'Refresh row changed during evaluation.' }; row.splice(index, 1); } if (policy.ordering.endsWith('top')) destination.push(...moved); else destination.unshift(...moved); if (policy.refill) refillSupplyConfiguration(state, ruleset, config, events); domainEvent(state, events, 'SUPPLY_ROW_REFRESHED', `Supply row refreshed by ${node.refreshPolicyId}.`); continue; }
    if (node.kind === 'refresh-shared-row-selection') {
      const row = state.zones[node.rowZoneId]; const deck = state.zones[node.sourceDeckZoneId];
      const config = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.sourceDeckZoneId === node.sourceDeckZoneId && entry.targetRowZoneId === node.rowZoneId);
      if (!row || row.visibility !== 'public' || !deck || deck.kind !== 'orderedDeck' || !config) return { status: 'failed', events, error: 'Shared-row refresh selection references an unknown supply configuration.' };
      const selected = row.cardIds.filter((cardId) => node.cardIds.includes(cardId));
      if (!sameJson(selected, node.cardIds)) return { status: 'failed', events, error: 'Shared-row refresh selection is not in current left-to-right row order.' };
      for (const cardId of selected) {
        const target = Object.values(state.enemyTargets).find((candidate) => candidate.cardInstanceId === cardId && candidate.status === 'available');
        if (!target || target.attachments.length) return { status: 'failed', events, error: 'Shared-row refresh requires one unattached available enemy target per selected card.' };
        target.status = 'removed';
        row.cardIds.splice(row.cardIds.indexOf(cardId), 1);
      }
      deck.cardIds.unshift(...[...selected].reverse());
      if (state.temporaryTargetModifiers) state.temporaryTargetModifiers = state.temporaryTargetModifiers.filter(({ targetCardId }) => !selected.includes(targetCardId));
      refillSupplyConfiguration(state, ruleset, config, events);
      attachTargets(state, ruleset);
      domainEvent(state, events, 'SUPPLY_ROW_REFRESHED', `Refreshed ${selected.length} selected public enemy cards.`);
      continue;
    }
    if (node.kind === 'enforce-team-capacity') {
      const enforcement = evaluateTeamCapacityEnforcement(state, ruleset, node.policyId);
      if (enforcement.status !== 'ready') return { status: enforcement.status, events, error: enforcement.error };
      for (const playerEvaluation of enforcement.evaluation.players) {
        if (!playerEvaluation.overflowCount) continue;
        const player = state.players.find(({ id }) => id === playerEvaluation.playerId);
        if (!player || playerEvaluation.candidateIds.length !== playerEvaluation.overflowCount) return { status: 'failed', events, error: 'Team capacity enforcement candidates are invalid.' };
        for (const cardId of playerEvaluation.candidateIds) {
          const index = player.party.findIndex(({ adventurerId }) => adventurerId === cardId);
          if (index < 0) return { status: 'failed', events, error: 'Team capacity enforcement candidate is no longer in the party.' };
          const [slot] = player.party.splice(index, 1);
          player.discardPile.push(slot!.adventurerId);
          player.discardPile.push(...attachedCardIds(slot!));
        }
        domainEvent(state, events, 'PARTY_MEMBER_DISCARDED', `${player.name} 因隊伍上限降低而移出最右側成員。`, {
          moduleId: enforcement.evaluation.policy.moduleId,
          payload: {
            schemaVersion: 1,
            kind: 'team-overflow',
            policy: { moduleId: enforcement.evaluation.policy.moduleId, policyId: enforcement.evaluation.policy.policyId },
            candidateIds: [...playerEvaluation.candidateIds],
          },
        });
      }
      continue;
    }
    if (node.kind === 'modify-value') { const id = playerId(node.target.player, context); const amount = numberValue(node.amount, state, ruleset, context); if (!id || amount === undefined) return { status: 'failed', events, error: 'Value target player or amount could not be resolved.' }; const player = getPlayer(state, id); if (node.target.kind === 'turn-purchase-bonus') player.turnPurchaseBonus += amount; else if (node.target.kind === 'turn-combat-bonus') player.turnCombatBonus += amount; else { const resourceId = node.target.resourceId; const counter = player.counters.find((item) => item.resourceId === resourceId); if (counter) counter.amount += amount; else player.counters.push({ resourceId, amount, visibility: 'ownerOnly' }); } domainEvent(state, events, 'EFFECT_VALUE_MODIFIED', 'Effect modified a serializable value.'); continue; }
    if (node.kind === 'create-enemy-encounter' || node.kind === 'create-enemy-target' || node.kind === 'attach-card-to-enemy-target' || node.kind === 'damage-enemy-target' || node.kind === 'defeat-enemy-target' || node.kind === 'remove-enemy-target' || node.kind === 'finish-enemy-encounter') { const result = node.kind === 'create-enemy-encounter' ? createEnemyEncounter(state, ruleset, node, events) : node.kind === 'create-enemy-target' ? createEnemyTarget(state, ruleset, node, context, events) : node.kind === 'attach-card-to-enemy-target' ? attachCardToEnemyTarget(state, ruleset, node, context, events) : node.kind === 'damage-enemy-target' ? damageEnemyTarget(state, ruleset, node, events) : node.kind === 'defeat-enemy-target' ? defeatEnemyTarget(state, ruleset, node, events) : node.kind === 'remove-enemy-target' ? removeEnemyTarget(state, ruleset, node, events) : finishEnemyEncounter(state, ruleset, node, events); if (!result.ok) return { status: 'failed', events, error: result.error }; continue; }
    const cardId = resolveCardId(node.card, context); if (!cardId) return { status: 'failed', events, error: 'Effect card reference could not be resolved.' };
    const to = node.kind === 'move-card' ? node.to : node.kind === 'discard-card' ? { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const : { kind: 'removed' } as const;
    const result = moveCard(state, { cardInstanceId: cardId, from: node.from, to, actorId: context.controllerId, context, registry: ruleset.registry, ...(node.kind === 'move-card' && node.position !== undefined ? { position: node.position } : {}), ...(node.permission !== undefined ? { permission: node.permission } : {}), ...(node.kind === 'move-card' && node.transferOwnership !== undefined ? { transferOwnership: node.transferOwnership } : {}), ...(node.kind === 'remove-from-game' && node.attachedEquipmentDisposition !== undefined ? { attachedEquipmentDisposition: node.attachedEquipmentDisposition } : {}) });
    if (!result.ok) return { status: 'failed', events, error: `${result.code}: ${result.message}` };
    if (to.kind === 'player-zone' && to.zone === 'discardPile') {
      const holderId = playerId(to.player, context); const destination = holderId ? discardDestination(state, ruleset, holderId, cardId) : undefined;
      if (holderId && destination && destination.id !== holderId) { const holder = getPlayer(state, holderId); holder.discardPile.splice(holder.discardPile.indexOf(cardId), 1); destination.discardPile.push(cardId); state.cards[cardId]!.ownerId = destination.id; }
    }
    domainEvent(state, events, 'CARD_MOVED', 'Effect moved a card.');
  }
  return { status: 'completed', events };
}
export function executeEffect(state: GameState, ruleset: Ruleset, effect: EffectDefinition, context: EffectContext, executionId: string): EffectExecutionResult { const events: DomainEvent[] = []; const validationErrors = validateEffectDefinition(effect); if (validationErrors.length) return { status: 'failed', events, error: `Invalid effect definition: ${validationErrors.join(' ')}` }; const next = structuredClone(state); if (next.effectState.pendingChoice || next.effectState.pendingCounterConsent) return { status: 'failed', events, error: 'Another effect suspension is pending.' }; domainEvent(next, events, 'EFFECT_STARTED', `Effect ${effect.effectId} started.`); const result = runNodes(next, ruleset, [effect.body], context, executionId, events); if (result.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Effect ${effect.effectId} completed.`); if (result.status === 'completed' || result.status === 'suspended') commitState(state, next); return result; }
export function resumeEffectChoice(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): EffectExecutionResult {
  const next = structuredClone(state); const events: DomainEvent[] = []; const pending = next.effectState.pendingChoice;
  if (!pending || pending.executionId !== executionId || pending.choiceId !== choiceId || pending.actorId !== actorId) return { status: 'failed', events, error: 'No matching pending effect choice.' };
  const option = pending.options.find((entry) => entry.id === optionId); if (!option) return { status: 'failed', events, error: 'Invalid pending effect choice option.' };
  if (pending.order) {
    const resolution = pending.order.resolutions.find((entry) => entry.optionId === optionId);
    const player = next.players.find(({ id }) => id === pending.order!.playerId);
    if (!resolution || !player) return { status: 'failed', events, error: 'Pending order target disappeared.' };
    if (pending.order.kind === 'party') {
      const current = player.party.map(({ adventurerId }) => adventurerId);
      if (!sameJson(current, pending.order.cardIds)) return { status: 'failed', events, error: 'Pending party order candidates changed before resolution.' };
      const byId = new Map(player.party.map((slot) => [slot.adventurerId, slot])); player.party = resolution.orderedCardIds.map((cardId) => byId.get(cardId)!);
      domainEvent(next, events, 'PLAYER_PARTY_REORDERED', `${player.name} reordered the party.`);
    } else {
      const top = player.drawPile.slice(-pending.order.cardIds.length);
      if (!sameJson(top, pending.order.cardIds)) return { status: 'failed', events, error: 'Pending deck order candidates changed before resolution.' };
      player.drawPile.splice(player.drawPile.length - pending.order.cardIds.length, pending.order.cardIds.length, ...resolution.orderedCardIds);
      if (resolution.removeCardId) { next.removedCards.push(resolution.removeCardId); domainEvent(next, events, 'CARD_REMOVED', `${player.name} privately removed one inspected card from the game.`); }
      domainEvent(next, events, 'PLAYER_DECK_REORDERED', `${player.name} privately reordered the inspected deck cards.`);
    }
  }
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
