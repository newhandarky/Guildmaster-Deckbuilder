import type {
  CommandEnvelope,
  CounterConsentPolicyRef,
  DomainEvent,
  EffectContext,
  GameState,
  LifecyclePayload,
  LifecycleRegistrySnapshot,
  PendingPostCommandContinuation
} from '@guildmaster/game-protocol';
import { dispatchLifecycle, resumeLifecycleChoice, resumeLifecycleCounterConsent } from '../effects/lifecycle-dispatcher.js';
import { validateRulesetStateCompatibility, type Ruleset } from '../rules/ruleset.js';
import { evaluateDiceRoll } from '../rules/dice-evaluator.js';

export type PostCommandBoundary = 'event-before' | 'event-after' | 'command-after';
export type PostCommandPipelineResult = {
  status: 'completed' | 'suspended' | 'failed' | 'unsupported';
  state: GameState;
  events: DomainEvent[];
  error?: string;
  rollback?: 'command' | 'none';
};

export type PostCommandPipelineCursor = {
  continuationId: string;
  envelope: CommandEnvelope;
  resolutionEnvelopes?: readonly CommandEnvelope[];
  rollbackState: GameState;
  facts: readonly DomainEvent[];
  factIndex: number;
  boundary: PostCommandBoundary;
  events: DomainEvent[];
};

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const contextFor = (envelope: CommandEnvelope): EffectContext => ({ controllerId: envelope.actorId });
const registryFor = (state: GameState, ruleset: Ruleset): LifecycleRegistrySnapshot => ({
  rulesetVersion: state.rulesetVersion,
  modules: ruleset.modules.map(({ id, version }) => ({ id, version }))
});

export function lifecyclePayloadFor(envelope: CommandEnvelope, state: GameState, point: PostCommandBoundary, fact?: DomainEvent): LifecyclePayload {
  return {
    schemaVersion: 1,
    point,
    actorId: envelope.actorId,
    ...(fact
      ? { eventType: fact.type, metadata: { commandId: envelope.commandId, eventId: fact.eventId } }
      : { commandType: envelope.command.type, metadata: { commandId: envelope.commandId } }),
    phase: state.phase
  };
}

function cleanCheckpoint(state: GameState): boolean {
  const effects = state.effectState;
  return !effects.pendingChoice && !effects.pendingCounterConsent && !effects.pendingLifecycle && !effects.pendingCommand && !effects.pendingPostCommand;
}

function compatibleCheckpoint(checkpoint: GameState, state: GameState): boolean {
  return checkpoint.gameId === state.gameId
    && checkpoint.engineVersion === state.engineVersion
    && checkpoint.rulesetVersion === state.rulesetVersion
    && same(checkpoint.contentPacks, state.contentPacks)
    && same(checkpoint.rulesModules, state.rulesModules);
}

function validateCounterConsentEventSequence(
  events: readonly DomainEvent[],
  state: GameState,
  registry: LifecycleRegistrySnapshot,
  ruleset?: Ruleset
): string | undefined {
  const consentEvents = events.filter((event) => event.payload?.kind === 'counter-consent');
  if (!consentEvents.length) return undefined;
  let request:
    | {
        requestId: string;
        policy: CounterConsentPolicyRef;
        counterOwnerId: string;
        requesterId: string;
        requiredActorIds: readonly string[];
        acceptedActorIds: string[];
        terminal: boolean;
        terminalStatus?: 'accepted' | 'declined' | 'cancelled' | 'expired';
      }
    | undefined;
  const eventType: Record<string, string> = {
    requested: 'COUNTER_CONSENT_REQUESTED',
    pending: 'COUNTER_CONSENT_ACCEPT_RECORDED',
    accepted: 'COUNTER_CONSENT_ACCEPTED',
    declined: 'COUNTER_CONSENT_DECLINED',
    cancelled: 'COUNTER_CONSENT_CANCELLED',
    expired: 'COUNTER_CONSENT_EXPIRED'
  };
  for (const event of consentEvents) {
    const payload = event.payload;
    if (payload?.kind !== 'counter-consent') return 'Transaction counter consent event payload is missing.';
    const evaluation = payload.evaluation;
    if (event.type !== eventType[evaluation.status]) return 'Transaction counter consent event type and status mismatch.';
    if (!same(evaluation.input.registry, registry)) return 'Transaction counter consent evaluation registry mismatch.';
    if (evaluation.input.action === 'request') {
      if (request && !request.terminal) return 'Transaction counter consent request starts before the prior request terminates.';
      if (
        evaluation.status !== 'requested'
        || evaluation.reasonCode !== 'CONSENT_REQUESTED'
        || evaluation.input.actorId !== evaluation.requesterId
        || evaluation.input.counterOwnerId !== evaluation.counterOwnerId
        || !same(evaluation.input.policy, evaluation.policy)
        || evaluation.acceptedActorIds.length
        || !evaluation.requiredActorIds.length
        || new Set(evaluation.requiredActorIds).size !== evaluation.requiredActorIds.length
        || evaluation.requiredActorIds.includes(evaluation.requesterId)
        || !same(evaluation.requiredActorIds, state.players.map(({ id }) => id).filter((id) => id !== evaluation.requesterId))
      ) return 'Transaction counter consent request evaluation is invalid or tampered.';
      if (ruleset) {
        const module = ruleset.modules.find(({ id }) => id === evaluation.policy.moduleId);
        const policy = module?.counterConsentPolicies?.find(({ policyId }) => policyId === evaluation.policy.policyId);
        const owner = state.players.find(({ id }) => id === evaluation.counterOwnerId);
        const counter = owner?.counters.find(({ resourceId }) => resourceId === policy?.resourceId);
        if (!module || !policy || !counter) return 'Transaction counter consent policy or target is unknown.';
      }
      request = {
        requestId: evaluation.input.requestId,
        policy: evaluation.policy,
        counterOwnerId: evaluation.counterOwnerId,
        requesterId: evaluation.requesterId,
        requiredActorIds: evaluation.requiredActorIds,
        acceptedActorIds: [],
        terminal: false
      };
      continue;
    }
    if (
      !request
      || request.terminal
      || evaluation.input.requestId !== request.requestId
      || !same(evaluation.policy, request.policy)
      || evaluation.counterOwnerId !== request.counterOwnerId
      || evaluation.requesterId !== request.requesterId
      || !same(evaluation.requiredActorIds, request.requiredActorIds)
    ) return 'Transaction counter consent continuation identity is invalid or tampered.';
    const actorId = evaluation.input.actorId;
    if (evaluation.input.action === 'accept') {
      if (!request.requiredActorIds.includes(actorId) || request.acceptedActorIds.includes(actorId)) return 'Transaction counter consent accept actor is invalid or duplicated.';
      request.acceptedActorIds.push(actorId);
      const complete = request.requiredActorIds.every((id) => request!.acceptedActorIds.includes(id));
      if (
        evaluation.status !== (complete ? 'accepted' : 'pending')
        || evaluation.reasonCode !== (complete ? 'ALL_REQUIRED_ACTORS_ACCEPTED' : 'ACCEPT_RECORDED')
        || !same(evaluation.acceptedActorIds, request.acceptedActorIds)
      ) return 'Transaction counter consent accept progression is invalid or tampered.';
      request.terminal = complete;
      if (complete) request.terminalStatus = 'accepted';
      continue;
    }
    const activeRequest = request;
    const registeredPolicy = ruleset
      ? ruleset.modules.find(({ id }) => id === activeRequest.policy.moduleId)
        ?.counterConsentPolicies?.find(({ policyId }) => policyId === activeRequest.policy.policyId)
      : undefined;
    const terminalMatches =
      (evaluation.input.action === 'decline' && evaluation.status === 'declined' && evaluation.reasonCode === 'REQUIRED_ACTOR_DECLINED' && activeRequest.requiredActorIds.includes(actorId) && !activeRequest.acceptedActorIds.includes(actorId))
      || (evaluation.input.action === 'cancel' && evaluation.status === 'cancelled' && evaluation.reasonCode === 'REQUESTER_CANCELLED' && actorId === activeRequest.requesterId)
      || (evaluation.input.action === 'expire'
        && evaluation.status === 'expired'
        && evaluation.reasonCode === 'REQUEST_EXPIRED'
        && state.players.some(({ id }) => id === actorId)
        && (!registeredPolicy || registeredPolicy.expiration.actor === 'any-player' || actorId === activeRequest.requesterId));
    if (!terminalMatches || !same(evaluation.acceptedActorIds, activeRequest.acceptedActorIds)) return 'Transaction counter consent terminal evaluation is invalid or tampered.';
    activeRequest.terminal = true;
    activeRequest.terminalStatus = evaluation.status as 'declined' | 'cancelled' | 'expired';
  }
  const pending = state.effectState.pendingCounterConsent;
  if (pending && (!request || request.terminal || request.requestId !== pending.requestId || !same(request.policy, pending.policy) || request.counterOwnerId !== pending.counterOwnerId || request.requesterId !== pending.requesterId || !same(request.requiredActorIds, pending.requiredActorIds) || !same(request.acceptedActorIds, pending.acceptedActorIds))) return 'Transaction counter consent events do not match the pending request.';
  if (!pending && request && !request.terminal) return 'Transaction counter consent events contain an unfinished request without a pending continuation.';
  if (request && ruleset) {
    const registeredPolicy = ruleset.modules.find(({ id }) => id === request.policy.moduleId)
      ?.counterConsentPolicies?.find(({ policyId }) => policyId === request.policy.policyId);
    const counter = state.players.find(({ id }) => id === request.counterOwnerId)
      ?.counters.find(({ resourceId }) => resourceId === registeredPolicy?.resourceId);
    const expectedVisibility = request.terminalStatus === 'accepted' ? 'public' : 'allPlayersByConsent';
    if (!registeredPolicy || !counter || counter.visibility !== expectedVisibility) return 'Transaction counter consent result does not match the authoritative counter state.';
  }
  return undefined;
}

export function validateTransactionEventSequence(
  events: readonly DomainEvent[],
  state: GameState,
  registry: LifecycleRegistrySnapshot,
  commandId: string,
  ruleset?: Ruleset
): string | undefined {
  if (new Set(events.map(({ eventId }) => eventId)).size !== events.length) return 'Transaction event IDs must be unique.';
  if (events.some((event, index) => event.eventId !== `transaction:${commandId}:${index + 1}`)) return 'Transaction event IDs must form one exact ordered command sequence.';
  if (events.some(({ revision }) => revision !== state.revision + 1)) return 'Transaction events must use the uncommitted command revision.';
  if (events.some(({ causedByCommandId }) => causedByCommandId !== commandId)) return 'Transaction events must identify their originating command.';
  for (const transactionEvent of events) {
    const dicePayload = transactionEvent.payload?.kind === 'dice-roll' ? transactionEvent.payload : undefined;
    if (dicePayload && !same(dicePayload.evaluation.input.registry, registry)) return 'Transaction dice evaluation registry mismatch.';
    if (dicePayload && ruleset) {
      const evaluated = evaluateDiceRoll(state, ruleset, dicePayload.evaluation.input);
      if (evaluated.status !== 'ready' || !same(evaluated.evaluation, dicePayload.evaluation)) return 'Transaction dice evaluation is invalid or tampered.';
    }
    const attackPayload = transactionEvent.payload?.kind === 'attack-resolution' ? transactionEvent.payload : undefined;
    if (attackPayload && (!same(attackPayload.evaluation.input.registry, registry) || !same(attackPayload.evaluation.combat.registry, registry) || !same(attackPayload.evaluation.damage.input.registry, registry))) return 'Transaction attack resolution registry mismatch.';
    if (attackPayload && ruleset) {
      const evaluation = attackPayload.evaluation;
      const policy = ruleset.modules.find(({ id }) => id === evaluation.policy.moduleId)?.attackResolutionPolicies?.find(({ policyId }) => policyId === evaluation.policy.policyId);
      const expectedOutcome = evaluation.combat.outcome.kind === 'remove-target' ? 'removed' : 'defeated';
      if (!policy || policy.damage.amount !== evaluation.damage.input.requestedDamage || !same(policy.encounterPolicy, evaluation.damage.input.policy) || !same(policy.reasonCode, evaluation.reasonCode) || (evaluation.damage.input.lethalOutcome ?? 'defeated') !== expectedOutcome) return 'Transaction attack resolution policy or evaluation is invalid or tampered.';
    }
  }
  return validateCounterConsentEventSequence(events, state, registry, ruleset);
}

/** Validates the JSON-only outer cursor and its relationship to the hook-level continuation. */
export function validatePostCommandContinuationState(state: GameState, ruleset?: Ruleset): string | undefined {
  const outer = state.effectState.pendingPostCommand;
  if (!outer) return undefined;
  const lifecycle = state.effectState.pendingLifecycle;
  const choice = state.effectState.pendingChoice;
  const consent = state.effectState.pendingCounterConsent;
  if (!lifecycle || Boolean(choice) === Boolean(consent) || state.effectState.pendingCommand) return 'Post-command continuation requires exactly one pending lifecycle suspension.';
  if (outer.schemaVersion !== 1 || outer.step !== 'resume-boundary' || outer.continuationId !== `post-command:${outer.envelope.commandId}`) return 'Malformed post-command continuation identity or step.';
  if (outer.envelope.command.type === 'RESOLVE_EFFECT_CHOICE') return 'Post-command continuation cannot contain a choice command.';
  if (outer.envelope.gameId !== state.gameId || outer.envelope.expectedRevision !== state.revision) return 'Post-command command envelope is incompatible with current state.';
  const resolutions = outer.resolutionEnvelopes ?? [];
  const commandIds = [outer.envelope.commandId, ...resolutions.map(({ commandId }) => commandId)];
  if (resolutions.length > 256 || new Set(commandIds).size !== commandIds.length || resolutions.some((resolution) => resolution.gameId !== state.gameId || resolution.expectedRevision !== outer.envelope.expectedRevision || (resolution.command.type !== 'RESOLVE_EFFECT_CHOICE' && resolution.command.type !== 'RESPOND_COUNTER_CONSENT' && resolution.command.type !== 'CANCEL_COUNTER_CONSENT' && resolution.command.type !== 'EXPIRE_COUNTER_CONSENT'))) return 'Post-command resolution transcript is malformed or duplicated.';
  if (lifecycle.context.controllerId !== outer.envelope.actorId || (choice && (choice.actorId !== outer.envelope.actorId || !same(choice.context, lifecycle.context))) || (consent && (consent.requesterId !== outer.envelope.actorId || !same(consent.context, lifecycle.context)))) return 'Post-command actor or effect context mismatch.';
  const expectedExecutionId = `${lifecycle.dispatchId}:${lifecycle.currentHook.moduleId}:${lifecycle.currentHook.hookId}`;
  if ((choice?.executionId ?? consent?.executionId) !== expectedExecutionId) return 'Post-command execution ID does not match the pending lifecycle hook.';
  if (!same(outer.payload, lifecycle.payload) || !same(outer.context, lifecycle.context) || !same(outer.registry, lifecycle.registry)) return 'Post-command lifecycle payload, context, or registry mismatch.';
  const stateRegistry: LifecycleRegistrySnapshot = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
  if (!same(outer.registry, stateRegistry)) return 'Post-command registry fingerprint does not match the Snapshot state.';
  if (!cleanCheckpoint(outer.rollbackState) || !compatibleCheckpoint(outer.rollbackState, state)) return 'Invalid or recursive post-command rollback checkpoint.';
  if (outer.rollbackState.revision !== outer.envelope.expectedRevision || outer.rollbackState.eventLogCursor !== state.eventLogCursor) return 'Post-command rollback revision or event cursor mismatch.';
  if (!cleanCheckpoint(lifecycle.rollbackState) || !compatibleCheckpoint(lifecycle.rollbackState, state)) return 'Invalid or recursive lifecycle rollback checkpoint.';
  const transactionError = validateTransactionEventSequence(outer.events, state, outer.registry, outer.envelope.commandId, ruleset);
  if (transactionError) return transactionError;
  if (new Set(outer.facts.map(({ eventId }) => eventId)).size !== outer.facts.length) return 'Post-command fact IDs must be unique.';
  if (outer.facts.some((fact) => { const matches = outer.events.filter((event) => event.eventId === fact.eventId); return fact.revision !== outer.envelope.expectedRevision + 1 || matches.length !== 1 || !same(matches[0], fact); })) return 'Post-command facts are missing, duplicated, modified, or use an invalid revision.';
  const factPositions = outer.facts.map((fact) => outer.events.findIndex((event) => event.eventId === fact.eventId));
  if (factPositions.some((position, index) => position < 0 || (index > 0 && position !== factPositions[index - 1]! + 1))) return 'Post-command facts must preserve their original contiguous transaction order.';
  for (const transactionEvent of outer.events) {
    const combatPayload = transactionEvent.payload?.kind === 'combat-evaluation' ? transactionEvent.payload : undefined;
    if ((transactionEvent.type === 'COMBAT_EVALUATED') !== Boolean(combatPayload)) return 'Post-command combat fact type and payload are inconsistent.';
    if (combatPayload && !same(combatPayload.evaluation.registry, outer.registry)) return 'Post-command combat evaluation registry mismatch.';
    const attackPayload = transactionEvent.payload?.kind === 'attack-resolution' ? transactionEvent.payload : undefined;
    if ((transactionEvent.type === 'ATTACK_RESOLUTION_EVALUATED') !== Boolean(attackPayload)) return 'Post-command attack resolution fact type and payload are inconsistent.';
    if (attackPayload && (!same(attackPayload.evaluation.input.registry, outer.registry) || !same(attackPayload.evaluation.combat.registry, outer.registry) || !same(attackPayload.evaluation.damage.input.registry, outer.registry))) return 'Post-command attack resolution registry mismatch.';
    const encounterPayload = transactionEvent.payload?.kind === 'encounter-resolution' ? transactionEvent.payload : undefined;
    const encounterTypes = new Set(['ENCOUNTER_CREATED', 'ENEMY_TARGET_CREATED', 'ENEMY_ATTACHMENT_ADDED', 'ENEMY_TARGET_DAMAGED', 'ENEMY_TARGET_DEFEATED', 'ENEMY_TARGET_REMOVED', 'ENCOUNTER_COMPLETED']);
    if (encounterTypes.has(transactionEvent.type) !== Boolean(encounterPayload)) return 'Post-command encounter fact type and payload are inconsistent.';
    if (encounterPayload && !same(encounterPayload.registry, outer.registry)) return 'Post-command encounter evaluation registry mismatch.';
  }
  if (outer.boundary === 'command-after') {
    if (outer.factIndex !== outer.facts.length || outer.payload.eventType !== undefined || outer.payload.commandType !== outer.envelope.command.type) return 'Command-after cursor still has unprocessed facts or an invalid payload.';
  } else {
    const fact = outer.facts[outer.factIndex];
    if (!fact || outer.factIndex < 0 || outer.payload.eventType !== fact.type || outer.payload.metadata?.eventId !== fact.eventId) return 'Post-command fact cursor is out of range or mismatched.';
  }
  if (outer.payload.point !== outer.boundary || outer.payload.actorId !== outer.envelope.actorId || outer.payload.metadata?.commandId !== outer.envelope.commandId) return 'Post-command boundary payload does not match its cursor.';
  if (ruleset) {
    const compatibilityError = validateRulesetStateCompatibility(state, ruleset);
    if (compatibilityError) return compatibilityError;
    if (!same(outer.registry, registryFor(state, ruleset))) return 'Post-command Rules Module registry mismatch.';
  }
  return undefined;
}

function advance(cursor: PostCommandPipelineCursor): boolean {
  if (cursor.boundary === 'event-before') {
    cursor.boundary = 'event-after';
    return true;
  }
  if (cursor.boundary === 'event-after' && cursor.factIndex + 1 < cursor.facts.length) {
    cursor.factIndex += 1;
    cursor.boundary = 'event-before';
    return true;
  }
  if (cursor.boundary === 'event-after') {
    cursor.factIndex = cursor.facts.length;
    cursor.boundary = 'command-after';
    return true;
  }
  return false;
}

function appendLifecycleEvents(cursor: PostCommandPipelineCursor, incoming: readonly DomainEvent[]): void {
  const start = cursor.events.length;
  cursor.events.push(...incoming.map((entry, index) => ({ ...clone(entry), eventId: `transaction:${cursor.envelope.commandId}:${start + index + 1}`, causedByCommandId: cursor.envelope.commandId })));
}

function suspend(state: GameState, cursor: PostCommandPipelineCursor): PostCommandPipelineResult {
  const pending = state.effectState.pendingLifecycle!;
  state.effectState.pendingPostCommand = {
    schemaVersion: 1,
    continuationId: cursor.continuationId,
    envelope: clone(cursor.envelope),
    ...(cursor.resolutionEnvelopes?.length ? { resolutionEnvelopes: clone(cursor.resolutionEnvelopes) } : {}),
    rollbackState: clone(cursor.rollbackState),
    facts: clone(cursor.facts),
    factIndex: cursor.factIndex,
    boundary: cursor.boundary,
    step: 'resume-boundary',
    events: clone(cursor.events),
    payload: clone(pending.payload),
    context: clone(pending.context),
    registry: clone(pending.registry)
  };
  return { status: 'suspended', state, events: clone(cursor.events) };
}

/** Continues from an exact fact/boundary cursor without invoking the command reducer. */
export function continuePostCommandPipeline(state: GameState, ruleset: Ruleset, cursor: PostCommandPipelineCursor): PostCommandPipelineResult {
  while (true) {
    const fact = cursor.boundary === 'command-after' ? undefined : cursor.facts[cursor.factIndex];
    if (cursor.boundary !== 'command-after' && !fact) return { status: 'failed', state, events: [], error: 'Post-command fact cursor is out of range.', rollback: 'command' };
    const payload = lifecyclePayloadFor(cursor.envelope, state, cursor.boundary, fact);
    const result = dispatchLifecycle(state, ruleset, payload, contextFor(cursor.envelope));
    appendLifecycleEvents(cursor, result.events);
    if (result.status === 'suspended') return suspend(state, cursor);
    if (result.status === 'failed' || result.status === 'unsupported') return { status: result.status, state, events: [], error: result.error ?? result.reason ?? `${cursor.boundary} lifecycle failed.`, rollback: 'command' };
    if (!advance(cursor)) return { status: 'completed', state, events: cursor.events };
  }
}

/** Starts post-command processing with reducer facts fixed exactly once. */
export function beginPostCommandPipeline(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, rollbackState: GameState, facts: readonly DomainEvent[], events: readonly DomainEvent[], resolutionEnvelopes: readonly CommandEnvelope[] = []): PostCommandPipelineResult {
  const normalizedEvents = events.map((entry, index) => ({ ...clone(entry), eventId: `transaction:${envelope.commandId}:${index + 1}`, causedByCommandId: envelope.commandId }));
  const normalizedFacts = normalizedEvents.slice(normalizedEvents.length - facts.length);
  const cursor: PostCommandPipelineCursor = {
    continuationId: `post-command:${envelope.commandId}`,
    envelope: clone(envelope),
    ...(resolutionEnvelopes.length ? { resolutionEnvelopes: clone(resolutionEnvelopes) } : {}),
    rollbackState: clone(rollbackState),
    facts: normalizedFacts,
    factIndex: 0,
    boundary: facts.length ? 'event-before' : 'command-after',
    events: normalizedEvents
  };
  return continuePostCommandPipeline(state, ruleset, cursor);
}

/** Resolves the current hook choice, then advances only from the serialized outer cursor. */
export function resumePostCommandPipeline(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string, resolutionEnvelope: CommandEnvelope): PostCommandPipelineResult {
  const validationError = validatePostCommandContinuationState(state, ruleset);
  const saved = state.effectState.pendingPostCommand;
  if (!saved) return { status: 'failed', state, events: [], error: 'No pending post-command continuation.', rollback: 'none' };
  if (validationError) return { status: 'failed', state, events: [], error: validationError, rollback: 'command' };
  const choice = state.effectState.pendingChoice!;
  if (actorId !== choice.actorId || executionId !== choice.executionId || choiceId !== choice.choiceId || !choice.options.some((option) => option.id === optionId)) {
    return { status: 'failed', state, events: [], error: 'No matching pending post-command effect choice.', rollback: 'none' };
  }
  const cursor: PostCommandPipelineCursor = {
    continuationId: saved.continuationId,
    envelope: clone(saved.envelope),
    resolutionEnvelopes: [...clone(saved.resolutionEnvelopes ?? []), clone(resolutionEnvelope)],
    rollbackState: clone(saved.rollbackState),
    facts: clone(saved.facts),
    factIndex: saved.factIndex,
    boundary: saved.boundary,
    events: clone([...saved.events])
  };
  const resumed = resumeLifecycleChoice(state, ruleset, actorId, executionId, choiceId, optionId);
  appendLifecycleEvents(cursor, resumed.events);
  if (resumed.status === 'suspended') return suspend(state, cursor);
  if (resumed.status === 'failed' || resumed.status === 'unsupported') return { status: resumed.status, state, events: [], error: resumed.error ?? resumed.reason ?? 'Post-command lifecycle resume failed.', rollback: 'command' };
  delete state.effectState.pendingPostCommand;
  if (!advance(cursor)) return { status: 'completed', state, events: cursor.events };
  return continuePostCommandPipeline(state, ruleset, cursor);
}

/** Resolves a counter consent action, then advances only from the serialized outer cursor. */
export function resumePostCommandCounterConsent(state: GameState, ruleset: Ruleset, actorId: string, requestId: string, action: 'accept' | 'decline' | 'cancel' | 'expire', resolutionEnvelope: CommandEnvelope): PostCommandPipelineResult {
  const validationError = validatePostCommandContinuationState(state, ruleset);
  const saved = state.effectState.pendingPostCommand;
  if (!saved) return { status: 'failed', state, events: [], error: 'No pending post-command continuation.', rollback: 'none' };
  if (validationError) return { status: 'failed', state, events: [], error: validationError, rollback: 'command' };
  const consent = state.effectState.pendingCounterConsent;
  if (!consent || requestId !== consent.requestId) return { status: 'failed', state, events: [], error: 'No matching pending post-command counter consent.', rollback: 'none' };
  const cursor: PostCommandPipelineCursor = { continuationId: saved.continuationId, envelope: clone(saved.envelope), resolutionEnvelopes: [...clone(saved.resolutionEnvelopes ?? []), clone(resolutionEnvelope)], rollbackState: clone(saved.rollbackState), facts: clone(saved.facts), factIndex: saved.factIndex, boundary: saved.boundary, events: clone([...saved.events]) };
  const resumed = resumeLifecycleCounterConsent(state, ruleset, actorId, requestId, action);
  appendLifecycleEvents(cursor, resumed.events);
  if (resumed.status === 'suspended') return suspend(state, cursor);
  if (resumed.status === 'failed' || resumed.status === 'unsupported') return { status: resumed.status, state, events: [], error: resumed.error ?? resumed.reason ?? 'Post-command counter consent resume failed.', rollback: 'command' };
  delete state.effectState.pendingPostCommand;
  if (!advance(cursor)) return { status: 'completed', state, events: cursor.events };
  return continuePostCommandPipeline(state, ruleset, cursor);
}

export type { PendingPostCommandContinuation };
