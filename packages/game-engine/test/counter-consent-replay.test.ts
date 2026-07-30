import { describe, expect, it } from 'vitest';
import {
  CommandEnvelopeSchema,
  ReplayBundleSchema,
  stableJsonFingerprint,
  type CommandEnvelope,
  type ContentPack,
  type DomainEvent,
  type EffectDefinition,
  type GameState,
  type LifecycleHook
} from '@guildmaster/game-protocol';
import {
  createGame,
  createRuleset,
  dispatch,
  projectPlayerView,
  replayRegistryFingerprint,
  restoreSnapshot,
  serializeSnapshot,
  validateReplayBundleAgainstRuleset
} from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import commandBeforeFixture from './fixtures/counter-consent-replay/command-before.json';
import postCommandFixture from './fixtures/counter-consent-replay/post-command.json';
import consentChoiceFixture from './fixtures/counter-consent-replay/consent-choice.json';
import negativeCompatibilityFixture from './fixtures/counter-consent-replay/negative.json';

type FixtureMode = 'command-before' | 'post-command' | 'consent-choice';
type ExpectedEvent = { eventId: string; type: string; causedByCommandId: string | null; reasonCode: string | null };
type ExpectedState = {
  phase: GameState['phase'];
  purchaseBonus: number;
  counterVisibility: 'public' | 'allPlayersByConsent';
  pendingConsent: boolean;
  acceptedActorIds: string[];
  pendingChoice: boolean;
  revision: number;
  eventLogCursor: number;
  rngState: number;
  stateFingerprint: string;
  orderedEvents: ExpectedEvent[];
};
type PositiveScenario = {
  id: string;
  gameId: string;
  mode: FixtureMode;
  players: string[];
  snapshotAfterCommandIndexes: number[];
  commands: CommandEnvelope[];
  expected: ExpectedState;
};
type PositiveFixture = { fixtureVersion: 1; scenarios: PositiveScenario[] };
type NegativeCase = {
  id: string;
  kind: 'replay-bundle' | 'command' | 'snapshot';
  mutation: string;
  expectedReasonCode?: string;
  expectedErrorCode?: string;
  expectedMessage?: string;
};
type NegativeFixture = { fixtureVersion: 1; cases: NegativeCase[] };
type MutablePendingSnapshot = {
  state: {
    effectState: {
      pendingCounterConsent: {
        policy: { moduleId: string; policyId: string };
        registry: { modules: { version: string }[] };
        status: string;
        acceptedActorIds: string[];
        requiredActorIds: string[];
      };
    };
  };
};

const positiveFixtures = [commandBeforeFixture, postCommandFixture, consentChoiceFixture].flatMap((fixture) => (fixture as unknown as PositiveFixture).scenarios);
const negativeFixture = negativeCompatibilityFixture as unknown as NegativeFixture;

const fixturePack: ContentPack = {
  manifest: { id: 'test:counter-replay-content', version: '1', hash: 'counter-replay-fixture', role: 'base' },
  definitions: [
    { id: 'test:counter-replay/stone', name: 'Fixture stone', type: 'starter', copies: 0, source: 'mvp-demo' },
    { id: 'test:counter-replay/crystal', name: 'Fixture crystal', type: 'starter', copies: 0, source: 'mvp-demo' }
  ],
  starter: { partyDefinitionIds: [], summonStoneDefinitionId: 'test:counter-replay/stone', crystalDefinitionId: 'test:counter-replay/crystal' },
  bonds: []
};

const modify = (amount: number): EffectDefinition['body'] => ({ kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount });
const acceptedOutcome = (mode: FixtureMode): EffectDefinition['body'] => mode === 'consent-choice'
  ? { kind: 'choice', choiceId: 'fixture-choice', actor: { kind: 'controller' }, options: [{ id: 'confirm', effect: modify(5) }] }
  : modify(10);
const effectBody = (mode: FixtureMode): EffectDefinition['body'] => ({
  kind: 'sequence',
  effects: [
    { kind: 'random', randomId: 'fixture-random', outcomes: [{ id: 'one', effect: modify(1) }, { id: 'two', effect: modify(2) }] },
    {
      kind: 'request-counter-consent',
      requestId: 'fixture-consent',
      policy: { moduleId: 'test:counter-replay', policyId: 'fixture-policy' },
      counterOwner: { kind: 'controller' },
      outcomes: { accepted: acceptedOutcome(mode), declined: modify(20), cancelled: modify(30), expired: modify(40) }
    },
    modify(3)
  ]
});

function fixtureRuleset(mode: FixtureMode): Ruleset {
  const point: LifecycleHook['point'] = mode === 'post-command' ? 'command-after' : 'command-before';
  const hook: LifecycleHook = {
    schemaVersion: 1,
    moduleId: 'test:counter-replay',
    hookId: `counter-replay-${point}`,
    point,
    kind: 'trigger',
    priority: 1,
    effect: { schemaVersion: 1, effectId: `test:counter-replay/${mode}`, body: effectBody(mode) }
  };
  const module: RulesModule = {
    id: 'test:counter-replay',
    version: '1',
    config: { fixtureMode: mode },
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
    lifecycleHooks: [hook],
    counterConsentPolicies: [{
      schemaVersion: 1,
      moduleId: 'test:counter-replay',
      policyId: 'fixture-policy',
      resourceId: 'test:counter-replay/token',
      requester: 'counter-owner',
      requiredConsent: 'all-other-players',
      expiration: { kind: 'explicit-command', actor: 'any-player' }
    }]
  };
  return createRuleset([fixturePack], [baseRulesModule, module]);
}

function initialState(scenario: Pick<PositiveScenario, 'gameId' | 'players' | 'mode'>): { state: GameState; ruleset: Ruleset } {
  const ruleset = fixtureRuleset(scenario.mode);
  const state = createGame({
    gameId: scenario.gameId,
    seed: 47,
    players: scenario.players.map((id) => ({ id, name: id.toUpperCase(), kind: 'human' as const })),
    startingPlayerId: 'p1'
  }, ruleset);
  state.players[0]!.counters.push({ resourceId: 'test:counter-replay/token', amount: 7, visibility: 'allPlayersByConsent' });
  return { state: restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset), ruleset };
}

function eventProjection(events: readonly DomainEvent[]): ExpectedEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    type: event.type,
    causedByCommandId: event.causedByCommandId ?? null,
    reasonCode: event.payload?.kind === 'counter-consent' ? event.payload.evaluation.reasonCode : null
  }));
}

function stateFingerprint(state: GameState): string {
  let hash = 0x811c9dc5;
  for (const character of stableJsonFingerprint(state)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function runScenario(scenario: PositiveScenario, roundTrip: boolean): { state: GameState; events: DomainEvent[]; ruleset: Ruleset } {
  const initial = initialState(scenario);
  let state = initial.state;
  const ruleset = initial.ruleset;
  let events: DomainEvent[] = [];
  const publicBundle = {
    schemaVersion: 1,
    protocolVersion: 1,
    registry: replayRegistryFingerprint(ruleset),
    initialConfig: {
      gameId: scenario.gameId,
      seed: 47,
      players: scenario.players.map((id) => ({ id, name: id.toUpperCase(), kind: 'human' as const })),
      startingPlayerId: 'p1'
    },
    commands: scenario.commands
  };
  expect(ReplayBundleSchema.parse(JSON.parse(JSON.stringify(publicBundle)))).toEqual(publicBundle);
  for (const [index, fixtureCommand] of scenario.commands.entries()) {
    const command = CommandEnvelopeSchema.parse(JSON.parse(JSON.stringify(fixtureCommand)));
    const result = dispatch(state, ruleset, command);
    expect(result.error, `${scenario.id} command ${index}`).toBeUndefined();
    state = result.state;
    events = result.events;
    if (roundTrip && scenario.snapshotAfterCommandIndexes.includes(index)) {
      const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(state)));
      const restored = restoreSnapshot(snapshot, ruleset);
      expect(restored).toEqual(state);
      state = restored;
    }
  }
  return { state, events, ruleset };
}

function expectScenario(scenario: PositiveScenario): void {
  const restored = runScenario(scenario, true);
  const uninterrupted = runScenario(scenario, false);
  expect(restored.state).toEqual(uninterrupted.state);
  expect(restored.events).toEqual(uninterrupted.events);
  const owner = restored.state.players[0]!;
  expect({
    phase: restored.state.phase,
    purchaseBonus: owner.turnPurchaseBonus,
    counterVisibility: owner.counters[0]!.visibility,
    pendingConsent: Boolean(restored.state.effectState.pendingCounterConsent),
    acceptedActorIds: restored.state.effectState.pendingCounterConsent?.acceptedActorIds ?? [],
    pendingChoice: Boolean(restored.state.effectState.pendingChoice),
    revision: restored.state.revision,
    eventLogCursor: restored.state.eventLogCursor,
    rngState: restored.state.rngState,
    stateFingerprint: stateFingerprint(restored.state),
    orderedEvents: eventProjection(restored.events)
  }).toEqual(scenario.expected);
  expect(new Set(restored.events.map(({ eventId }) => eventId)).size).toBe(restored.events.length);
  const observer = restored.state.players[1]!.id;
  const visibleCounters = projectPlayerView(restored.state, restored.ruleset, observer).opponents.find(({ id }) => id === 'p1')!.counters;
  expect(visibleCounters).toEqual(scenario.expected.counterVisibility === 'public' ? [{ resourceId: 'test:counter-replay/token', amount: 7, visibility: 'public' }] : []);
}

function suspendedFixtureState(): { state: GameState; ruleset: Ruleset } {
  const scenario = positiveFixtures.find(({ id }) => id === 'request')!;
  const { state, ruleset } = initialState(scenario);
  const result = dispatch(state, ruleset, scenario.commands[0]!);
  expect(result.error).toBeUndefined();
  return { state: result.state, ruleset };
}

describe('counter consent replay compatibility fixtures', () => {
  it.each(positiveFixtures.map((scenario) => [scenario.id, scenario] as const))('replays %s deterministically through JSON and exact Snapshot cursors', (_id, scenario) => {
    expectScenario(scenario);
  });

  it.each(negativeFixture.cases.map((entry) => [entry.id, entry] as const))('rejects negative fixture %s without changing pending state', (_id, entry) => {
    const { state, ruleset } = suspendedFixtureState();
    const before = structuredClone(state);
    if (entry.kind === 'replay-bundle') {
      const fixture = positiveFixtures[0]!;
      const replay = {
        schemaVersion: entry.mutation === 'schema-version' ? 99 : 1,
        protocolVersion: entry.mutation === 'protocol-version' ? 99 : 1,
        registry: replayRegistryFingerprint(ruleset),
        initialConfig: { gameId: fixture.gameId, seed: 47, players: fixture.players.map((id) => ({ id, name: id.toUpperCase(), kind: 'human' })), startingPlayerId: 'p1' },
        commands: fixture.commands
      };
      expect(validateReplayBundleAgainstRuleset(replay, ruleset).diagnostic?.reasonCode).toBe(entry.expectedReasonCode);
      return;
    }
    if (entry.kind === 'command') {
      const command: Record<string, unknown> = {
        protocolVersion: 1,
        gameId: state.gameId,
        commandId: `negative-${entry.id}`,
        actorId: 'p2',
        expectedRevision: state.revision,
        command: { type: 'RESPOND_COUNTER_CONSENT', requestId: 'fixture-consent', response: 'accept' }
      };
      if (entry.mutation === 'malformed-response') (command.command as Record<string, unknown>).response = 'maybe';
      if (entry.mutation === 'command-version') command.protocolVersion = 99;
      if (entry.mutation === 'wrong-actor') command.actorId = 'p1';
      if (entry.mutation === 'wrong-game') command.gameId = 'wrong';
      if (entry.mutation === 'wrong-revision') command.expectedRevision = state.revision + 1;
      if (entry.mutation === 'wrong-request') (command.command as Record<string, unknown>).requestId = 'wrong';
      if (entry.mutation === 'unrelated-command') command.command = { type: 'END_PHASE', phase: 'action1' };
      const result = dispatch(state, ruleset, command as unknown as CommandEnvelope);
      expect(result.error?.code).toBe(entry.expectedErrorCode);
      expect(result.state).toEqual(before);
      expect(state).toEqual(before);
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(state))) as MutablePendingSnapshot;
    const pending = snapshot.state.effectState.pendingCounterConsent;
    if (entry.mutation === 'unknown-module') pending.policy.moduleId = 'missing';
    if (entry.mutation === 'unknown-policy') pending.policy.policyId = 'missing';
    if (entry.mutation === 'module-version') pending.registry.modules[1]!.version = 'wrong';
    if (entry.mutation === 'malformed-pending') pending.status = 'accepted';
    if (entry.mutation === 'accepted-actors') pending.acceptedActorIds = ['p2', 'p3'];
    if (entry.mutation === 'required-actors') pending.requiredActorIds = ['p3'];
    expect(() => restoreSnapshot(snapshot, ruleset)).toThrow(new RegExp(entry.expectedMessage!, 'i'));
    expect(state).toEqual(before);
  });
});
