import type { DomainEvent, EffectContext, EffectDefinition, EffectNode, GameState } from '@guildmaster/game-protocol';
import { drawCards } from '../engine/draw.js';
import { getPlayer } from '../model/factories.js';
import { nextRandom } from '../ports/random.js';
import type { Ruleset } from '../rules/ruleset.js';
import { isCardAtLocation, moveCard, resolveCardId, resolveLocation } from './movement.js';

export type EffectOrderResolution = { status: 'ready'; orderedIds: readonly string[] } | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED' };
/** Never infer trigger/replacement ordering from array order or active player. */
export function resolveEffectOrder(entries: readonly { id: string; priority?: number }[], policy?: 'explicit-priority'): EffectOrderResolution {
  if (entries.length < 2) return { status: 'ready', orderedIds: entries.map((entry) => entry.id) };
  if (policy !== 'explicit-priority' || entries.some((entry) => entry.priority === undefined)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  const ordered = [...entries].sort((left, right) => left.priority! - right.priority!); if (ordered.some((entry, index) => index > 0 && entry.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' };
  return { status: 'ready', orderedIds: ordered.map((entry) => entry.id) };
}

export type EffectExecutionResult = { status: 'completed' | 'suspended' | 'failed' | 'unsupported'; events: DomainEvent[]; error?: string };
const domainEvent = (state: GameState, events: DomainEvent[], type: string, message: string) => events.push({ eventId: `effect-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message });
const playerId = (ref: import('@guildmaster/game-protocol').EffectPlayerRef, context: EffectContext) => ref.kind === 'controller' ? context.controllerId : ref.kind === 'player-id' ? ref.playerId : context.playerRefs?.[ref.key];
function commitState(target: GameState, source: GameState): void { Object.assign(target, source); }

function runNodes(state: GameState, ruleset: Ruleset, nodes: readonly EffectNode[], context: EffectContext, executionId: string, events: DomainEvent[]): EffectExecutionResult {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind === 'sequence') { const result = runNodes(state, ruleset, node.effects, context, executionId, events); if (result.status !== 'completed') return result; continue; }
    if (node.kind === 'conditional') { const valid = node.condition.kind === 'always' ? node.condition.value : (() => { const id = resolveCardId(node.condition.card, context); const location = resolveLocation(node.condition.location, context); try { return Boolean(id && location && state.cards[id] && isCardAtLocation(state, location, id)); } catch { return false; } })(); const next = valid ? node.whenTrue : node.whenFalse; if (next) { const result = runNodes(state, ruleset, [next], context, executionId, events); if (result.status !== 'completed') return result; } continue; }
    if (node.kind === 'choice') { const actorId = playerId(node.actor, context); if (!actorId) return { status: 'failed', events, error: 'Choice actor could not be resolved.' }; state.effectState.pendingChoice = { schemaVersion: 1, executionId, choiceId: node.choiceId, actorId, options: node.options, remaining: nodes.slice(index + 1), context }; domainEvent(state, events, 'EFFECT_SUSPENDED', 'Effect requires an explicit player choice.'); return { status: 'suspended', events }; }
    if (node.kind === 'random') { if (!node.outcomes.length) return { status: 'failed', events, error: 'Random effect has no outcomes.' }; const outcome = node.outcomes[Math.floor(nextRandom(state) * node.outcomes.length)]!; domainEvent(state, events, 'EFFECT_RANDOM_RESOLVED', `Deterministic random outcome: ${outcome.id}.`); const result = runNodes(state, ruleset, [outcome.effect], context, executionId, events); if (result.status !== 'completed') return result; continue; }
    if (node.kind === 'draw') { const id = playerId(node.player, context); if (!id) return { status: 'failed', events, error: 'Draw player could not be resolved.' }; drawCards(state, id, node.count, events); continue; }
    if (node.kind === 'modify-value') { const id = playerId(node.target.player, context); if (!id) return { status: 'failed', events, error: 'Value target player could not be resolved.' }; const player = getPlayer(state, id); if (node.target.kind === 'turn-purchase-bonus') player.turnPurchaseBonus += node.amount; else if (node.target.kind === 'turn-combat-bonus') player.turnCombatBonus += node.amount; else { const resourceId = node.target.resourceId; const counter = player.counters.find((item) => item.resourceId === resourceId); if (counter) counter.amount += node.amount; else player.counters.push({ resourceId, amount: node.amount, visibility: 'ownerOnly' }); } domainEvent(state, events, 'EFFECT_VALUE_MODIFIED', 'Effect modified a serializable value.'); continue; }
    const cardId = resolveCardId(node.card, context); if (!cardId) return { status: 'failed', events, error: 'Effect card reference could not be resolved.' };
    const to = node.kind === 'move-card' ? node.to : node.kind === 'discard-card' ? { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' } as const : { kind: 'removed' } as const;
    const result = moveCard(state, { cardInstanceId: cardId, from: node.from, to, actorId: context.controllerId, context, registry: ruleset.registry, ...(node.kind === 'move-card' && node.position !== undefined ? { position: node.position } : {}), ...(node.permission !== undefined ? { permission: node.permission } : {}), ...(node.kind === 'move-card' && node.transferOwnership !== undefined ? { transferOwnership: node.transferOwnership } : {}) });
    if (!result.ok) return { status: 'failed', events, error: `${result.code}: ${result.message}` }; domainEvent(state, events, 'CARD_MOVED', 'Effect moved a card.');
  }
  return { status: 'completed', events };
}
export function executeEffect(state: GameState, ruleset: Ruleset, effect: EffectDefinition, context: EffectContext, executionId: string): EffectExecutionResult { const next = structuredClone(state); const events: DomainEvent[] = []; if (next.effectState.pendingChoice) return { status: 'failed', events, error: 'Another effect choice is pending.' }; domainEvent(next, events, 'EFFECT_STARTED', `Effect ${effect.effectId} started.`); const result = runNodes(next, ruleset, [effect.body], context, executionId, events); if (result.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Effect ${effect.effectId} completed.`); if (result.status === 'completed' || result.status === 'suspended') commitState(state, next); return result; }
export function resumeEffectChoice(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): EffectExecutionResult {
  const next = structuredClone(state); const events: DomainEvent[] = []; const pending = next.effectState.pendingChoice;
  if (!pending || pending.executionId !== executionId || pending.choiceId !== choiceId || pending.actorId !== actorId) return { status: 'failed', events, error: 'No matching pending effect choice.' };
  const option = pending.options.find((entry) => entry.id === optionId); if (!option) return { status: 'failed', events, error: 'Invalid pending effect choice option.' };
  delete next.effectState.pendingChoice; const result = runNodes(next, ruleset, [option.effect, ...pending.remaining], pending.context, executionId, events); if (result.status === 'completed') domainEvent(next, events, 'EFFECT_COMPLETED', `Effect choice ${choiceId} completed.`); if (result.status === 'completed' || result.status === 'suspended') commitState(state, next); return result;
}
