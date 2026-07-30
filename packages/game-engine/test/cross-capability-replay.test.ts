import { describe, expect, it } from 'vitest';
import {
  CommandEnvelopeSchema,
  stableJsonFingerprint,
  type CommandEnvelope,
  type ContentPack,
  type DomainEvent,
  type EffectDefinition,
  type EffectNode,
  type GameState,
  type LifecycleHook
} from '@guildmaster/game-protocol';
import {
  createGame,
  createRuleset,
  dispatch,
  restoreSnapshot,
  serializeSnapshot
} from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import mixedFixtureJson from './fixtures/cross-capability-replay/mixed-continuations.json';
import negativeFixtureJson from './fixtures/cross-capability-replay/negative.json';

type FixtureMode = 'dice-consent-choice' | 'choice-dice-consent' | 'post-command-mixed' | 'post-command-rollback';
type ExpectedEvent = string;
type ContinuationGolden = {
  index: number;
  kind: 'choice' | 'consent';
  executionId: string;
  suspensionId: string;
  acceptedActorIds: string[];
  boundary: 'command-before' | 'event-before' | 'event-after' | 'command-after';
  factIndex: number | null;
  eventCount: number;
  revision: number;
  eventLogCursor: number;
  rngState: number;
  snapshotFingerprint: string;
};
type ExpectedState = {
  phase: GameState['phase'];
  purchaseBonus: number;
  counterVisibility: 'public' | 'ownerOnly' | 'allPlayersByConsent';
  revision: number;
  eventLogCursor: number;
  rngState: number;
  stateFingerprint: string;
  continuations: ContinuationGolden[];
  orderedEvents: ExpectedEvent[];
};
type PositiveScenario = {
  id: string;
  gameId: string;
  mode: Exclude<FixtureMode, 'post-command-rollback'>;
  players: string[];
  snapshotAfterCommandIndexes: number[];
  commands: CommandEnvelope[];
  expected: ExpectedState;
};
type RollbackScenario = {
  id: string;
  gameId: string;
  mode: 'post-command-rollback';
  players: string[];
  snapshotAfterCommandIndexes: number[];
  failureCommandIndex: number;
  expectedErrorCode: string;
  commands: CommandEnvelope[];
};
type MixedFixture = { fixtureVersion: 1; scenarios: PositiveScenario[]; rollbackScenarios: RollbackScenario[] };
type NegativeCase = {
  id: string;
  source: PositiveScenario['id'];
  checkpoint: number;
  mutation:
    | 'dice-face'
    | 'dice-registry'
    | 'choice-id'
    | 'choice-cursor'
    | 'consent-actors'
    | 'consent-request-id'
    | 'duplicate-event-id'
    | 'duplicate-suspended-events'
    | 'mixed-cursor'
    | 'unknown-module'
    | 'unknown-policy'
    | 'module-version'
    | 'snapshot-version';
  expectedMessage: string;
};
type NegativeFixture = { fixtureVersion: 1; cases: NegativeCase[] };
type MutableSnapshot = {
  schemaVersion: number;
  state: GameState;
};

const mixedFixture = mixedFixtureJson as unknown as MixedFixture;
const negativeFixture = negativeFixtureJson as unknown as NegativeFixture;

const fixturePack: ContentPack = {
  manifest: { id: 'test:cross-replay-content', version: '1', hash: 'cross-replay-fixture', role: 'base' },
  definitions: [
    { id: 'test:cross-replay/stone', name: 'Fixture stone', type: 'starter', copies: 0, source: 'mvp-demo' },
    { id: 'test:cross-replay/crystal', name: 'Fixture crystal', type: 'starter', copies: 0, source: 'mvp-demo' }
  ],
  starter: {
    partyDefinitionIds: [],
    summonStoneDefinitionId: 'test:cross-replay/stone',
    crystalDefinitionId: 'test:cross-replay/crystal'
  },
  bonds: []
};

const modify = (amount: number): EffectNode => ({
  kind: 'modify-value',
  target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } },
  amount
});
const choice = (choiceId: string, amount: number): EffectNode => ({
  kind: 'choice',
  choiceId,
  actor: { kind: 'controller' },
  options: [
    { id: 'confirm', effect: modify(amount) },
    { id: 'skip', effect: modify(0) }
  ]
});
const die = (): EffectNode => ({
  kind: 'roll-die',
  moduleId: 'test:cross-replay',
  diceId: 'fixture-d6',
  outcomes: Array.from({ length: 6 }, (_, index) => ({ face: index + 1, effect: modify(index + 1) }))
});
const consent = (requestId: string, accepted: EffectNode, tail: number): EffectNode => ({
  kind: 'sequence',
  effects: [
    {
      kind: 'request-counter-consent',
      requestId,
      policy: { moduleId: 'test:cross-replay', policyId: 'fixture-policy' },
      counterOwner: { kind: 'controller' },
      outcomes: {
        accepted,
        declined: modify(-10),
        cancelled: modify(-20),
        expired: modify(-30)
      }
    },
    modify(tail)
  ]
});
const hook = (
  hookId: string,
  point: LifecycleHook['point'],
  body: EffectDefinition['body'],
  eventType?: string
): LifecycleHook => ({
  schemaVersion: 1,
  moduleId: 'test:cross-replay',
  hookId,
  point,
  kind: point === 'event-before' ? 'replacement' : 'trigger',
  priority: 1,
  effect: { schemaVersion: 1, effectId: `test:cross-replay/${hookId}`, body },
  ...(eventType ? { eventType } : {})
});

function fixtureHooks(mode: FixtureMode): LifecycleHook[] {
  if (mode === 'dice-consent-choice') {
    return [hook('dice-consent-choice', 'command-before', {
      kind: 'sequence',
      effects: [die(), consent('dice-consent', choice('after-consent-choice', 10), 100)]
    })];
  }
  if (mode === 'choice-dice-consent') {
    return [hook('choice-dice-consent', 'command-before', {
      kind: 'sequence',
      effects: [choice('before-dice-choice', 5), die(), consent('choice-dice-consent', modify(10), 100)]
    })];
  }
  const late = mode === 'post-command-rollback'
    ? {
        kind: 'move-card',
        card: { kind: 'card-instance', cardInstanceId: 'missing' },
        from: { kind: 'removed' },
        to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' }
      } satisfies EffectNode
    : choice('post-after-choice', 30);
  return [
    hook('post-event-before-choice', 'event-before', choice('post-before-choice', 5), 'PHASE_ENDED'),
    hook('post-event-after-mixed', 'event-after', {
      kind: 'sequence',
      effects: [die(), consent('post-mixed-consent', modify(10), 20)]
    }, 'PHASE_ENDED'),
    hook('post-command-after-choice', 'command-after', late)
  ];
}

function fixtureRuleset(mode: FixtureMode, moduleVersion = '1'): Ruleset {
  const module: RulesModule = {
    id: 'test:cross-replay',
    version: moduleVersion,
    config: { fixtureMode: mode },
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
    lifecycleHooks: fixtureHooks(mode),
    diceDefinitions: [{ schemaVersion: 1, moduleId: 'test:cross-replay', diceId: 'fixture-d6', sides: 6 }],
    counterConsentPolicies: [{
      schemaVersion: 1,
      moduleId: 'test:cross-replay',
      policyId: 'fixture-policy',
      resourceId: 'test:cross-replay/token',
      requester: 'counter-owner',
      requiredConsent: 'all-other-players',
      expiration: { kind: 'explicit-command', actor: 'any-player' }
    }]
  };
  return createRuleset([fixturePack], [baseRulesModule, module]);
}

function initialState(scenario: Pick<PositiveScenario | RollbackScenario, 'gameId' | 'players' | 'mode'>): { state: GameState; ruleset: Ruleset } {
  const ruleset = fixtureRuleset(scenario.mode);
  const created = createGame({
    gameId: scenario.gameId,
    seed: 47,
    players: scenario.players.map((id) => ({ id, name: id.toUpperCase(), kind: 'human' as const })),
    startingPlayerId: 'p1'
  }, ruleset);
  created.players[0]!.counters.push({
    resourceId: 'test:cross-replay/token',
    amount: 7,
    visibility: 'allPlayersByConsent'
  });
  return {
    state: restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(created))), ruleset),
    ruleset
  };
}

function stateFingerprint(state: GameState): string {
  let hash = 0x811c9dc5;
  for (const character of stableJsonFingerprint(state)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function eventProjection(events: readonly DomainEvent[]): ExpectedEvent[] {
  return events.map((event) => [
    event.eventId,
    event.type,
    event.causedByCommandId ?? '-',
    event.payload?.kind === 'counter-consent' ? event.payload.evaluation.reasonCode : '-',
    event.payload?.kind === 'dice-roll' ? String(event.payload.evaluation.face) : '-'
  ].join('|'));
}

function continuationProjection(state: GameState, index: number): ContinuationGolden {
  const pendingChoice = state.effectState.pendingChoice;
  const pendingConsent = state.effectState.pendingCounterConsent;
  const pendingCommand = state.effectState.pendingCommand;
  const pendingPost = state.effectState.pendingPostCommand;
  if (Boolean(pendingChoice) === Boolean(pendingConsent)) throw new Error('Fixture checkpoint must contain exactly one suspension.');
  return {
    index,
    kind: pendingChoice ? 'choice' : 'consent',
    executionId: (pendingChoice ?? pendingConsent)!.executionId,
    suspensionId: pendingChoice?.choiceId ?? pendingConsent!.requestId,
    acceptedActorIds: [...(pendingConsent?.acceptedActorIds ?? [])],
    boundary: pendingPost?.boundary ?? 'command-before',
    factIndex: pendingPost?.factIndex ?? null,
    eventCount: pendingPost?.events.length ?? pendingCommand?.events.length ?? 0,
    revision: state.revision,
    eventLogCursor: state.eventLogCursor,
    rngState: state.rngState,
    snapshotFingerprint: stateFingerprint(state)
  };
}

function roundTrip(state: GameState, ruleset: Ruleset): GameState {
  const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(state)));
  const restored = restoreSnapshot(snapshot, ruleset);
  expect(restored).toEqual(state);
  return restored;
}

function runPositive(scenario: PositiveScenario, useSnapshots: boolean): {
  state: GameState;
  events: DomainEvent[];
  continuations: ContinuationGolden[];
  auditEvents: DomainEvent[];
} {
  const initial = initialState(scenario);
  let state = initial.state;
  let events: DomainEvent[] = [];
  const continuations: ContinuationGolden[] = [];
  const auditEvents: DomainEvent[] = [];
  for (const [index, commandJson] of scenario.commands.entries()) {
    const command = CommandEnvelopeSchema.parse(JSON.parse(JSON.stringify(commandJson)));
    const priorCursor = state.eventLogCursor;
    const result = dispatch(state, initial.ruleset, command);
    expect(result.error, `${scenario.id} command ${index}: ${result.error?.message}`).toBeUndefined();
    state = result.state;
    events = result.events;
    if (state.eventLogCursor > priorCursor) auditEvents.push(...result.events);
    if (scenario.snapshotAfterCommandIndexes.includes(index)) {
      continuations.push(continuationProjection(state, index));
      if (useSnapshots) state = roundTrip(state, initial.ruleset);
    }
  }
  return { state, events, continuations, auditEvents };
}

function positiveGolden(result: ReturnType<typeof runPositive>): ExpectedState {
  const owner = result.state.players[0]!;
  return {
    phase: result.state.phase,
    purchaseBonus: owner.turnPurchaseBonus,
    counterVisibility: owner.counters[0]!.visibility,
    revision: result.state.revision,
    eventLogCursor: result.state.eventLogCursor,
    rngState: result.state.rngState,
    stateFingerprint: stateFingerprint(result.state),
    continuations: result.continuations,
    orderedEvents: eventProjection(result.events)
  };
}

function checkpointSnapshot(entry: NegativeCase): { snapshot: MutableSnapshot; ruleset: Ruleset; state: GameState } {
  const scenario = mixedFixture.scenarios.find(({ id }) => id === entry.source);
  if (!scenario) throw new Error(`Unknown fixture source: ${entry.source}`);
  const initial = initialState(scenario);
  let state = initial.state;
  for (let index = 0; index <= entry.checkpoint; index += 1) {
    const command = CommandEnvelopeSchema.parse(JSON.parse(JSON.stringify(scenario.commands[index]!)));
    const result = dispatch(state, initial.ruleset, command);
    expect(result.error).toBeUndefined();
    state = result.state;
  }
  return {
    snapshot: JSON.parse(JSON.stringify(serializeSnapshot(state))) as MutableSnapshot,
    ruleset: initial.ruleset,
    state
  };
}

function mutateSnapshot(snapshot: MutableSnapshot, mutation: NegativeCase['mutation']): void {
  const state = snapshot.state;
  const transactionEvents = [...(state.effectState.pendingPostCommand?.events ?? state.effectState.pendingCommand?.events ?? [])];
  const setTransactionEvents = (events: DomainEvent[]): void => {
    if (state.effectState.pendingPostCommand) state.effectState.pendingPostCommand.events = events;
    else if (state.effectState.pendingCommand) state.effectState.pendingCommand.events = events;
    else throw new Error('Negative fixture has no pending transaction events.');
  };
  const pendingChoice = () => {
    if (!state.effectState.pendingChoice) throw new Error('Negative fixture has no pending choice.');
    return state.effectState.pendingChoice;
  };
  const pendingConsent = () => {
    if (!state.effectState.pendingCounterConsent) throw new Error('Negative fixture has no pending counter consent.');
    return state.effectState.pendingCounterConsent;
  };
  const pendingPostCommand = () => {
    if (!state.effectState.pendingPostCommand) throw new Error('Negative fixture has no pending post-command continuation.');
    return state.effectState.pendingPostCommand;
  };
  if (mutation === 'dice-face') {
    const event = transactionEvents.find(({ payload }) => payload?.kind === 'dice-roll');
    if (!event || event.payload?.kind !== 'dice-roll') throw new Error('Negative fixture has no dice event.');
    event.payload.evaluation.face = 6;
  } else if (mutation === 'dice-registry') {
    const event = transactionEvents.find(({ payload }) => payload?.kind === 'dice-roll');
    if (!event || event.payload?.kind !== 'dice-roll') throw new Error('Negative fixture has no dice event.');
    event.payload.evaluation.input.registry.modules[1]!.version = 'tampered';
  } else if (mutation === 'choice-id') {
    pendingChoice().choiceId = 'tampered-choice';
  } else if (mutation === 'choice-cursor') {
    // This node exists in the registered option program but is not the
    // continuation that follows the pending choice.
    pendingChoice().remaining = [modify(5)];
  } else if (mutation === 'consent-actors') {
    const event = [...transactionEvents].reverse().find(({ payload }) => payload?.kind === 'counter-consent');
    if (!event || event.payload?.kind !== 'counter-consent') throw new Error('Negative fixture has no counter consent event.');
    event.payload.evaluation.requiredActorIds = ['p3'];
  } else if (mutation === 'consent-request-id') {
    const event = transactionEvents.find(({ payload }) => payload?.kind === 'counter-consent');
    if (!event || event.payload?.kind !== 'counter-consent') throw new Error('Negative fixture has no counter consent event.');
    event.payload.evaluation.input.requestId = 'tampered-request';
  } else if (mutation === 'duplicate-event-id') {
    if (!transactionEvents[0] || !transactionEvents[1]) throw new Error('Negative fixture needs two transaction events.');
    transactionEvents[1].eventId = transactionEvents[0].eventId;
  } else if (mutation === 'duplicate-suspended-events') {
    setTransactionEvents([...transactionEvents, ...structuredClone(transactionEvents)]);
  } else if (mutation === 'mixed-cursor') {
    pendingPostCommand().factIndex = 99;
  } else if (mutation === 'unknown-module') {
    pendingConsent().policy.moduleId = 'missing';
  } else if (mutation === 'unknown-policy') {
    pendingConsent().policy.policyId = 'missing';
  } else if (mutation === 'module-version') {
    const module = pendingPostCommand().registry.modules[1];
    if (!module) throw new Error('Negative fixture has no test Rules Module registry entry.');
    module.version = 'missing';
  } else {
    snapshot.schemaVersion = 99;
  }
}

describe('cross-capability fixed JSON replay regression fixtures', () => {
  it.each(mixedFixture.scenarios.map((scenario) => [scenario.id, scenario] as const))(
    'keeps %s deterministic across every requested Snapshot boundary',
    (_id, scenario) => {
      const restored = runPositive(scenario, true);
      const uninterrupted = runPositive(scenario, false);
      expect(restored.state).toEqual(uninterrupted.state);
      expect(restored.events).toEqual(uninterrupted.events);
      expect(restored.continuations).toEqual(uninterrupted.continuations);
      expect(restored.auditEvents).toEqual(restored.events);
      expect(new Set(restored.events.map(({ eventId }) => eventId)).size).toBe(restored.events.length);
      expect(restored.events.every(({ eventId }) => eventId.startsWith(`transaction:${scenario.commands[0]!.commandId}:`))).toBe(true);
      expect(restored.events.filter(({ type }) => type === 'DIE_ROLLED')).toHaveLength(1);
      expect(restored.events.filter(({ causedByCommandId }) => causedByCommandId && causedByCommandId !== scenario.commands[0]!.commandId)).toEqual([]);
      const golden = positiveGolden(restored);
      expect(golden).toEqual(scenario.expected);
    }
  );

  it.each(mixedFixture.rollbackScenarios.map((scenario) => [scenario.id, scenario] as const))(
    'rolls %s back to the original command checkpoint after late mixed failure',
    (_id, scenario) => {
      const initial = initialState(scenario);
      const before = structuredClone(initial.state);
      let state = initial.state;
      for (const [index, commandJson] of scenario.commands.entries()) {
        const command = CommandEnvelopeSchema.parse(JSON.parse(JSON.stringify(commandJson)));
        const result = dispatch(state, initial.ruleset, command);
        if (index === scenario.failureCommandIndex) {
          expect(result.error?.code).toBe(scenario.expectedErrorCode);
          expect(result.events).toEqual([]);
          expect(result.state).toEqual(before);
          expect(result.state.revision).toBe(0);
          expect(result.state.eventLogCursor).toBe(0);
          expect(result.state.rngState).toBe(47);
          return;
        }
        expect(result.error).toBeUndefined();
        state = scenario.snapshotAfterCommandIndexes.includes(index) ? roundTrip(result.state, initial.ruleset) : result.state;
      }
      throw new Error('Fixture did not reach its expected failure command.');
    }
  );

  it.each(negativeFixture.cases.map((entry) => [entry.id, entry] as const))(
    'rejects negative mixed Snapshot fixture %s',
    (_id, entry) => {
      const { snapshot, ruleset, state } = checkpointSnapshot(entry);
      const before = structuredClone(state);
      mutateSnapshot(snapshot, entry.mutation);
      expect(() => restoreSnapshot(snapshot, ruleset)).toThrow(new RegExp(entry.expectedMessage, 'i'));
      expect(state).toEqual(before);
    }
  );

  it('rejects unknown fixture Rules Module versions without accepting a registry-compatible-looking Snapshot', () => {
    const scenario = mixedFixture.scenarios[0]!;
    const result = runPositive({ ...scenario, commands: scenario.commands.slice(0, 1) }, false);
    const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(result.state)));
    expect(() => restoreSnapshot(snapshot, fixtureRuleset(scenario.mode, '2'))).toThrow(/registry fingerprint/i);
  });
});
