import type {
  CommandEnvelope,
  DomainEvent,
  EffectContext,
  GameState,
  LifecyclePayload,
  LifecycleRegistrySnapshot,
  PendingPostCommandContinuation
} from '@guildmaster/game-protocol';
import { dispatchLifecycle, resumeLifecycleChoice } from '../effects/lifecycle-dispatcher.js';
import type { Ruleset } from '../rules/ruleset.js';

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
  return !effects.pendingChoice && !effects.pendingLifecycle && !effects.pendingCommand && !effects.pendingPostCommand;
}

function compatibleCheckpoint(checkpoint: GameState, state: GameState): boolean {
  return checkpoint.gameId === state.gameId
    && checkpoint.engineVersion === state.engineVersion
    && checkpoint.rulesetVersion === state.rulesetVersion
    && same(checkpoint.contentPacks, state.contentPacks)
    && same(checkpoint.rulesModules, state.rulesModules);
}

/** Validates the JSON-only outer cursor and its relationship to the hook-level continuation. */
export function validatePostCommandContinuationState(state: GameState, ruleset?: Ruleset): string | undefined {
  const outer = state.effectState.pendingPostCommand;
  if (!outer) return undefined;
  const lifecycle = state.effectState.pendingLifecycle;
  const choice = state.effectState.pendingChoice;
  if (!lifecycle || !choice || state.effectState.pendingCommand) return 'Post-command continuation requires exactly one pending lifecycle choice.';
  if (outer.schemaVersion !== 1 || outer.step !== 'resume-boundary' || outer.continuationId !== `post-command:${outer.envelope.commandId}`) return 'Malformed post-command continuation identity or step.';
  if (outer.envelope.command.type === 'RESOLVE_EFFECT_CHOICE') return 'Post-command continuation cannot contain a choice command.';
  if (outer.envelope.gameId !== state.gameId || outer.envelope.expectedRevision !== state.revision) return 'Post-command command envelope is incompatible with current state.';
  if (choice.actorId !== outer.envelope.actorId || lifecycle.context.controllerId !== outer.envelope.actorId || !same(choice.context, lifecycle.context)) return 'Post-command actor or effect context mismatch.';
  const expectedExecutionId = `${lifecycle.dispatchId}:${lifecycle.currentHook.moduleId}:${lifecycle.currentHook.hookId}`;
  if (choice.executionId !== expectedExecutionId) return 'Post-command execution ID does not match the pending lifecycle hook.';
  if (!same(outer.payload, lifecycle.payload) || !same(outer.context, lifecycle.context) || !same(outer.registry, lifecycle.registry)) return 'Post-command lifecycle payload, context, or registry mismatch.';
  const stateRegistry: LifecycleRegistrySnapshot = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
  if (!same(outer.registry, stateRegistry)) return 'Post-command registry fingerprint does not match the Snapshot state.';
  if (!cleanCheckpoint(outer.rollbackState) || !compatibleCheckpoint(outer.rollbackState, state)) return 'Invalid or recursive post-command rollback checkpoint.';
  if (outer.rollbackState.revision !== outer.envelope.expectedRevision || outer.rollbackState.eventLogCursor !== state.eventLogCursor) return 'Post-command rollback revision or event cursor mismatch.';
  if (!cleanCheckpoint(lifecycle.rollbackState) || !compatibleCheckpoint(lifecycle.rollbackState, state)) return 'Invalid or recursive lifecycle rollback checkpoint.';
  if (new Set(outer.events.map(({ eventId }) => eventId)).size !== outer.events.length) return 'Post-command transaction event IDs must be unique.';
  if (new Set(outer.facts.map(({ eventId }) => eventId)).size !== outer.facts.length) return 'Post-command fact IDs must be unique.';
  const commandFacts = outer.events.filter(({ causedByCommandId }) => causedByCommandId === outer.envelope.commandId);
  if (!same(outer.facts, commandFacts)) return 'Post-command facts must equal the complete ordered reducer fact segment.';
  if (outer.facts.some((fact) => { const matches = outer.events.filter((event) => event.eventId === fact.eventId); return fact.revision !== outer.envelope.expectedRevision + 1 || matches.length !== 1 || !same(matches[0], fact); })) return 'Post-command facts are missing, duplicated, modified, or use an invalid revision.';
  const factPositions = outer.facts.map((fact) => outer.events.findIndex((event) => event.eventId === fact.eventId));
  if (factPositions.some((position, index) => position < 0 || (index > 0 && position !== factPositions[index - 1]! + 1))) return 'Post-command facts must preserve their original contiguous transaction order.';
  for (const transactionEvent of outer.events) {
    const combatPayload = transactionEvent.payload?.kind === 'combat-evaluation' ? transactionEvent.payload : undefined;
    if ((transactionEvent.type === 'COMBAT_EVALUATED') !== Boolean(combatPayload)) return 'Post-command combat fact type and payload are inconsistent.';
    if (combatPayload && !same(combatPayload.evaluation.registry, outer.registry)) return 'Post-command combat evaluation registry mismatch.';
  }
  if (outer.boundary === 'command-after') {
    if (outer.factIndex !== outer.facts.length || outer.payload.eventType !== undefined || outer.payload.commandType !== outer.envelope.command.type) return 'Command-after cursor still has unprocessed facts or an invalid payload.';
  } else {
    const fact = outer.facts[outer.factIndex];
    if (!fact || outer.factIndex < 0 || outer.payload.eventType !== fact.type || outer.payload.metadata?.eventId !== fact.eventId) return 'Post-command fact cursor is out of range or mismatched.';
  }
  if (outer.payload.point !== outer.boundary || outer.payload.actorId !== outer.envelope.actorId || outer.payload.metadata?.commandId !== outer.envelope.commandId) return 'Post-command boundary payload does not match its cursor.';
  if (ruleset && !same(outer.registry, registryFor(state, ruleset))) return 'Post-command Rules Module registry mismatch.';
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
  cursor.events.push(...incoming.map((entry, index) => ({ ...clone(entry), eventId: `transaction:${cursor.envelope.commandId}:${start + index + 1}` })));
}

function suspend(state: GameState, cursor: PostCommandPipelineCursor): PostCommandPipelineResult {
  const pending = state.effectState.pendingLifecycle!;
  state.effectState.pendingPostCommand = {
    schemaVersion: 1,
    continuationId: cursor.continuationId,
    envelope: clone(cursor.envelope),
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
export function beginPostCommandPipeline(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope, rollbackState: GameState, facts: readonly DomainEvent[], events: readonly DomainEvent[]): PostCommandPipelineResult {
  const factStart = events.length - facts.length;
  const normalizedEvents = events.map((entry, index) => ({ ...clone(entry), eventId: `transaction:${envelope.commandId}:${index + 1}`, ...(index >= factStart ? { causedByCommandId: envelope.commandId } : {}) }));
  const normalizedFacts = normalizedEvents.slice(normalizedEvents.length - facts.length);
  const cursor: PostCommandPipelineCursor = {
    continuationId: `post-command:${envelope.commandId}`,
    envelope: clone(envelope),
    rollbackState: clone(rollbackState),
    facts: normalizedFacts,
    factIndex: 0,
    boundary: facts.length ? 'event-before' : 'command-after',
    events: normalizedEvents
  };
  return continuePostCommandPipeline(state, ruleset, cursor);
}

/** Resolves the current hook choice, then advances only from the serialized outer cursor. */
export function resumePostCommandPipeline(state: GameState, ruleset: Ruleset, actorId: string, executionId: string, choiceId: string, optionId: string): PostCommandPipelineResult {
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

export type { PendingPostCommandContinuation };
