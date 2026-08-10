import type { CommandEnvelope, DomainEvent, EffectContext, EffectDefinition, GameState } from '@guildmaster/game-protocol';
import { executeEffect, resumeEffectChoice, resumeEffectCounterConsent, validatePendingChoiceAgainstEffect, validatePendingCounterConsentAgainstEffect } from '../effects/executor.js';
import { validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';

type Result = { status: 'completed' | 'suspended' | 'failed' | 'unsupported'; events: DomainEvent[]; error?: string; rollback?: 'command' | 'none' };
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const registry = (state: GameState) => ({ rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) });
const executionId = (envelope: CommandEnvelope): string => `item-use:${envelope.commandId}`;
const continuationId = (envelope: CommandEnvelope): string => `card-use-effect:${envelope.commandId}`;
const maxResolutionEnvelopes = 256;
const normalizeEvents = (events: readonly DomainEvent[], envelope: CommandEnvelope): DomainEvent[] => events.map((entry, index) => ({
  ...entry,
  eventId: `transaction:${envelope.commandId}:${index + 1}`,
  revision: envelope.expectedRevision + 1,
  causedByCommandId: envelope.commandId,
}));

function save(
  state: GameState,
  envelope: CommandEnvelope,
  resolutionEnvelopes: readonly CommandEnvelope[],
  rollbackState: GameState,
  events: readonly DomainEvent[],
  factStart: number,
  context: EffectContext,
): void {
  state.effectState.pendingCommand = {
    schemaVersion: 1,
    kind: 'card-use-effect',
    continuationId: continuationId(envelope),
    envelope: structuredClone(envelope),
    resolutionEnvelopes: structuredClone(resolutionEnvelopes),
    rollbackState: structuredClone(rollbackState),
    events: normalizeEvents(events, envelope),
    factStart,
    context: structuredClone(context),
    registry: registry(state),
  };
}

function definitionFor(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EffectDefinition | undefined {
  if (envelope.command.type !== 'USE_ITEM') return undefined;
  const card = state.cards[envelope.command.cardId];
  return card ? ruleset.registry.definitions[card.definitionId]?.useEffect : undefined;
}

export function validatePendingCardUseContinuation(state: GameState, ruleset: Ruleset): string | undefined {
  const compatibilityError = validateRulesetStateCompatibility(state, ruleset);
  if (compatibilityError) return compatibilityError;
  const pending = state.effectState.pendingCommand;
  if (!pending || pending.kind !== 'card-use-effect') return 'No pending card-use continuation.';
  const choice = state.effectState.pendingChoice; const consent = state.effectState.pendingCounterConsent;
  const commandIds = [pending.envelope.commandId, ...pending.resolutionEnvelopes.map(({ commandId }) => commandId)];
  if (Boolean(choice) === Boolean(consent) || state.effectState.pendingLifecycle || state.effectState.pendingPostCommand || pending.envelope.command.type !== 'USE_ITEM' || pending.continuationId !== continuationId(pending.envelope) || pending.envelope.gameId !== state.gameId || pending.envelope.expectedRevision !== state.revision || pending.envelope.actorId !== state.activePlayerId || !same(pending.registry, registry(state)) || pending.resolutionEnvelopes.length > maxResolutionEnvelopes || new Set(commandIds).size !== commandIds.length || pending.resolutionEnvelopes.some((resolution) => resolution.gameId !== state.gameId || resolution.expectedRevision !== pending.envelope.expectedRevision || (resolution.command.type !== 'RESOLVE_EFFECT_CHOICE' && resolution.command.type !== 'RESPOND_COUNTER_CONSENT' && resolution.command.type !== 'CANCEL_COUNTER_CONSENT' && resolution.command.type !== 'EXPIRE_COUNTER_CONSENT'))) return 'Malformed card-use continuation.';
  const rollbackEffects = pending.rollbackState.effectState;
  if (rollbackEffects.pendingChoice || rollbackEffects.pendingCounterConsent || rollbackEffects.pendingCommand || rollbackEffects.pendingLifecycle || rollbackEffects.pendingPostCommand) return 'Recursive card-use rollback checkpoint.';
  if (pending.rollbackState.gameId !== state.gameId || pending.rollbackState.engineVersion !== state.engineVersion || pending.rollbackState.rulesetVersion !== state.rulesetVersion || !same(pending.rollbackState.contentPacks, state.contentPacks) || !same(pending.rollbackState.rulesModules, state.rulesModules) || pending.rollbackState.revision !== pending.envelope.expectedRevision || pending.rollbackState.eventLogCursor !== state.eventLogCursor) return 'Card-use rollback checkpoint is incompatible with the suspended state.';
  const cardId = pending.envelope.command.cardId;
  const rollbackPlayer = pending.rollbackState.players.find(({ id }) => id === pending.envelope.actorId);
  const currentPlayer = state.players.find(({ id }) => id === pending.envelope.actorId);
  if (!rollbackPlayer?.hand.includes(cardId) || !currentPlayer?.playArea.includes(cardId) || pending.context.controllerId !== pending.envelope.actorId || pending.context.cardRefs?.source !== cardId) return 'Card-use continuation has an invalid card location or context.';
  const effect = definitionFor(state, ruleset, pending.envelope);
  const suspension = choice ?? consent;
  if (!effect || !suspension || suspension.executionId !== executionId(pending.envelope)) return 'Card-use continuation effect or suspension is unavailable.';
  if (new Set(pending.events.map(({ eventId }) => eventId)).size !== pending.events.length) return 'Card-use continuation events must have unique IDs.';
  return choice
    ? validatePendingChoiceAgainstEffect(choice, effect, state, ruleset)
    : validatePendingCounterConsentAgainstEffect(consent!, effect);
}

export function beginCardUseEffectPipeline(
  state: GameState,
  ruleset: Ruleset,
  envelope: CommandEnvelope,
  resolutionEnvelopes: readonly CommandEnvelope[],
  rollbackState: GameState,
  events: DomainEvent[],
  factStart: number,
  effect: EffectDefinition,
  context: EffectContext,
): Result {
  let result;
  try {
    result = executeEffect(state, ruleset, effect, context, executionId(envelope));
  } catch (error) {
    return { status: 'failed', events: [], error: error instanceof Error ? error.message : 'Card-use effect execution failed.' };
  }
  const combined = normalizeEvents([...events, ...result.events], envelope);
  if (result.status === 'suspended') save(state, envelope, resolutionEnvelopes, rollbackState, combined, factStart, context);
  return { status: result.status, events: combined, ...(result.error ? { error: result.error } : {}) };
}

export function resumeCardUseEffectChoice(state: GameState, ruleset: Ruleset, resolutionEnvelope: CommandEnvelope): Result {
  const error = validatePendingCardUseContinuation(state, ruleset);
  const pending = state.effectState.pendingCommand;
  if (error || !pending || pending.kind !== 'card-use-effect') return { status: 'failed', events: [], error: error ?? 'No pending card-use continuation.', rollback: 'none' };
  const command = resolutionEnvelope.command;
  const choice = state.effectState.pendingChoice;
  if (command.type !== 'RESOLVE_EFFECT_CHOICE' || !choice || resolutionEnvelope.actorId !== choice.actorId || command.executionId !== choice.executionId || command.choiceId !== choice.choiceId || !choice.options.some(({ id }) => id === command.optionId)) return { status: 'failed', events: [], error: 'No matching pending card-use effect choice.', rollback: 'none' };
  const result = resumeEffectChoice(state, ruleset, resolutionEnvelope.actorId, command.executionId, command.choiceId, command.optionId);
  if (result.status === 'failed' || result.status === 'unsupported') return { status: result.status, events: [], error: result.error ?? 'Card-use choice failed.', rollback: 'command' };
  const events = normalizeEvents([...pending.events, ...result.events], pending.envelope);
  if (result.status === 'suspended') save(state, pending.envelope, [...pending.resolutionEnvelopes, resolutionEnvelope], pending.rollbackState, events, pending.factStart, pending.context);
  else delete state.effectState.pendingCommand;
  return { status: result.status, events, ...(result.error ? { error: result.error } : {}) };
}

export function resumeCardUseEffectCounterConsent(state: GameState, ruleset: Ruleset, resolutionEnvelope: CommandEnvelope, action: 'accept' | 'decline' | 'cancel' | 'expire'): Result {
  const error = validatePendingCardUseContinuation(state, ruleset);
  const pending = state.effectState.pendingCommand;
  if (error || !pending || pending.kind !== 'card-use-effect') return { status: 'failed', events: [], error: error ?? 'No pending card-use continuation.', rollback: 'none' };
  const command = resolutionEnvelope.command;
  const consent = state.effectState.pendingCounterConsent;
  if ((command.type !== 'RESPOND_COUNTER_CONSENT' && command.type !== 'CANCEL_COUNTER_CONSENT' && command.type !== 'EXPIRE_COUNTER_CONSENT') || !consent || command.requestId !== consent.requestId) return { status: 'failed', events: [], error: 'No matching pending card-use counter consent.', rollback: 'none' };
  const result = resumeEffectCounterConsent(state, ruleset, resolutionEnvelope.actorId, command.requestId, action);
  if (result.status === 'failed' || result.status === 'unsupported') return { status: result.status, events: [], error: result.error ?? 'Card-use counter consent failed.', rollback: 'command' };
  const events = normalizeEvents([...pending.events, ...result.events], pending.envelope);
  if (result.status === 'suspended') save(state, pending.envelope, [...pending.resolutionEnvelopes, resolutionEnvelope], pending.rollbackState, events, pending.factStart, pending.context);
  else delete state.effectState.pendingCommand;
  return { status: result.status, events, ...(result.error ? { error: result.error } : {}) };
}
