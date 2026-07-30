import { describe, expect, it } from 'vitest';
import type { CounterConsentPolicy, EffectDefinition, GameCommand, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateCounterConsent, getLegalCommands, projectPlayerView, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const policy = (overrides: Partial<CounterConsentPolicy> = {}): CounterConsentPolicy => ({ schemaVersion: 1, moduleId: 'test:consent', policyId: 'share-token', resourceId: 'test:token', requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' }, ...overrides });
const modify = (amount: number): EffectDefinition['body'] => ({ kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount });
const request = (accepted: EffectDefinition['body'] = modify(10)): EffectDefinition['body'] => ({ kind: 'request-counter-consent', requestId: 'share-request', policy: { moduleId: 'test:consent', policyId: 'share-token' }, counterOwner: { kind: 'controller' }, outcomes: { accepted, declined: modify(20), cancelled: modify(30), expired: modify(40) } });
const hook = (point: LifecycleHook['point'], body: EffectDefinition['body']): LifecycleHook => ({ schemaVersion: 1, moduleId: 'test:consent', hookId: `consent-${point}`, point, kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: `test:consent/${point}`, body } });
const module = (hooks: readonly LifecycleHook[] = [], policies: readonly CounterConsentPolicy[] = [policy()], version = '1'): RulesModule => ({ id: 'test:consent', version, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: hooks, counterConsentPolicies: policies });
const rules = (hooks: readonly LifecycleHook[] = [], policies?: readonly CounterConsentPolicy[]) => createRuleset([testPack], [baseRulesModule, module(hooks, policies)]);
const game = (ruleset: Ruleset, players = 3) => {
  const state = createGame({ gameId: 'consent-game', seed: 29, players: Array.from({ length: players }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, kind: 'human' as const })), startingPlayerId: 'p1' }, ruleset);
  state.players[0]!.counters.push({ resourceId: 'test:token', amount: 7, visibility: 'allPlayersByConsent' });
  return state;
};
const end = (state: ReturnType<typeof game>, actorId = 'p1', commandId = 'end') => envelope(state, actorId, { type: 'END_PHASE', phase: state.phase }, commandId);
const consentCommand = (state: ReturnType<typeof game>, actorId: string, command: GameCommand, commandId: string) => envelope(state, actorId, command, commandId);

describe('generic counter consent lifecycle', () => {
  it('registers only owned, unique, finite JSON policies', () => {
    expect(() => rules([], [policy({ moduleId: 'wrong' })])).toThrow('must belong');
    expect(() => rules([], [policy(), policy()])).toThrow('Duplicate counter consent policy');
    const invalid = policy() as CounterConsentPolicy & { callback?: () => void }; invalid.callback = () => undefined;
    expect(() => rules([], [invalid])).toThrow('finite, acyclic, plain JSON');
  });

  it('shares one deterministic evaluator between legal query and authoritative dispatch', () => {
    const ruleset = rules([hook('command-before', request())]); const state = game(ruleset);
    const suspended = dispatch(state, ruleset, end(state)).state; const pending = suspended.effectState.pendingCounterConsent!;
    expect(getLegalCommands(suspended, ruleset, 'p2')).toEqual([
      { type: 'RESPOND_COUNTER_CONSENT', requestId: pending.requestId, response: 'accept' },
      { type: 'RESPOND_COUNTER_CONSENT', requestId: pending.requestId, response: 'decline' },
      { type: 'EXPIRE_COUNTER_CONSENT', requestId: pending.requestId }
    ]);
    expect(getLegalCommands(suspended, ruleset, 'p1')).toEqual([
      { type: 'CANCEL_COUNTER_CONSENT', requestId: pending.requestId },
      { type: 'EXPIRE_COUNTER_CONSENT', requestId: pending.requestId }
    ]);
    const evaluated = evaluateCounterConsent(suspended, ruleset, { schemaVersion: 1, action: 'accept', actorId: 'p2', requestId: pending.requestId, registry: pending.registry });
    expect(evaluated).toMatchObject({ status: 'ready', evaluation: { status: 'pending', reasonCode: 'ACCEPT_RECORDED' } });
  });

  it('round-trips a multi-actor request and commits the original command exactly once', () => {
    const body: EffectDefinition['body'] = { kind: 'sequence', effects: [{ kind: 'random', randomId: 'before-consent', outcomes: [{ id: 'one', effect: modify(1) }, { id: 'two', effect: modify(2) }] }, request(), modify(3)] };
    const ruleset = rules([hook('command-before', body)]); const initial = game(ruleset); const initialRng = initial.rngState;
    const suspended = dispatch(initial, ruleset, end(initial, 'p1', 'transaction'));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.eventLogCursor).toBe(0); expect(suspended.state.rngState).not.toBe(initialRng);
    const rng = suspended.state.rngState;
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const partial = dispatch(restored, ruleset, consentCommand(restored, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'accept-p2'));
    expect(partial.error).toBeUndefined(); expect(partial.state.revision).toBe(0); expect(partial.state.eventLogCursor).toBe(0); expect(partial.state.rngState).toBe(rng); expect(partial.state.effectState.pendingCounterConsent?.acceptedActorIds).toEqual(['p2']);
    const completed = dispatch(partial.state, ruleset, consentCommand(partial.state, 'p3', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'accept-p3'));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.eventLogCursor).toBe(completed.events.length); expect(completed.state.rngState).toBe(rng); expect(completed.state.phase).toBe('combat'); expect(completed.state.effectState).toEqual({});
    expect(completed.state.players[0]!.counters[0]!.visibility).toBe('public');
    expect(completed.events.filter(({ type }) => type === 'COUNTER_CONSENT_REQUESTED')).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'COUNTER_CONSENT_ACCEPT_RECORDED')).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'COUNTER_CONSENT_ACCEPTED')).toHaveLength(1);
  });

  it.each([
    ['declined', 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'decline' } as const, 20, 'COUNTER_CONSENT_DECLINED'],
    ['cancelled', 'p1', { type: 'CANCEL_COUNTER_CONSENT', requestId: 'share-request' } as const, 30, 'COUNTER_CONSENT_CANCELLED'],
    ['expired', 'p2', { type: 'EXPIRE_COUNTER_CONSENT', requestId: 'share-request' } as const, 40, 'COUNTER_CONSENT_EXPIRED']
  ])('has an explicit %s terminal outcome without revealing the counter', (_status, actorId, command, amount, eventType) => {
    const ruleset = rules([hook('command-before', request())]); const state = game(ruleset, 2); const suspended = dispatch(state, ruleset, end(state)).state;
    const result = dispatch(suspended, ruleset, consentCommand(suspended, actorId, command, `terminal-${_status}`));
    expect(result.error).toBeUndefined(); expect(result.state.revision).toBe(1); expect(result.state.phase).toBe('combat'); expect(result.state.players[0]!.turnPurchaseBonus).toBe(amount); expect(result.state.players[0]!.counters[0]!.visibility).toBe('allPlayersByConsent'); expect(result.events.some(({ type }) => type === eventType)).toBe(true);
  });

  it('validates actor, gameId, revision, requestId and blocks unrelated commands without mutation', () => {
    const ruleset = rules([hook('command-before', request())]); const state = game(ruleset); const suspended = dispatch(state, ruleset, end(state)).state; const before = structuredClone(suspended);
    const attempts = [
      consentCommand(suspended, 'p1', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'owner-cannot-accept'),
      consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'wrong', response: 'accept' }, 'wrong-request'),
      { ...consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'wrong-game'), gameId: 'wrong' },
      { ...consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'stale'), expectedRevision: suspended.revision + 1 },
      end(suspended, 'p1', 'bypass')
    ];
    for (const attempt of attempts) expect(dispatch(suspended, ruleset, attempt).error).toBeDefined();
    expect(suspended).toEqual(before);
  });

  it('preserves viewer redaction until unanimous acceptance and exposes only public counters', () => {
    const ruleset = rules([hook('command-before', request())]); const state = game(ruleset, 2); const before = projectPlayerView(state, ruleset, 'p2');
    expect(before.opponents[0]!.counters).toEqual([]);
    const suspended = dispatch(state, ruleset, end(state)).state; expect(projectPlayerView(suspended, ruleset, 'p2').pendingCounterConsent).toMatchObject({ requestId: 'share-request', status: 'pending' });
    const completed = dispatch(suspended, ruleset, consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'accept')).state;
    expect(projectPlayerView(completed, ruleset, 'p2').opponents[0]!.counters).toEqual([{ resourceId: 'test:token', amount: 7, visibility: 'public' }]);
  });

  it('continues from counter consent into a choice without rerunning prior work', () => {
    const accepted: EffectDefinition['body'] = { kind: 'choice', choiceId: 'after-consent', actor: { kind: 'controller' }, options: [{ id: 'ok', effect: modify(5) }] };
    const ruleset = rules([hook('command-before', { kind: 'sequence', effects: [modify(1), request(accepted), modify(2)] })]); const state = game(ruleset, 2);
    const suspended = dispatch(state, ruleset, end(state, 'p1', 'choice-chain')).state;
    const acceptedState = dispatch(suspended, ruleset, consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'accept')).state;
    expect(acceptedState.revision).toBe(0); expect(acceptedState.effectState.pendingCounterConsent).toBeUndefined(); expect(acceptedState.effectState.pendingChoice?.choiceId).toBe('after-consent'); expect(acceptedState.players[0]!.turnPurchaseBonus).toBe(1);
    const choice = getLegalCommands(acceptedState, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(acceptedState, ruleset, envelope(acceptedState, 'p1', choice, 'choice'));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.phase).toBe('combat'); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(8);
  });

  it('supports post-command suspension and rolls the whole command back if accepted continuation fails', () => {
    const bad: EffectDefinition['body'] = { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'removed' } };
    const ruleset = rules([hook('command-after', request(bad))]); const state = game(ruleset, 2); const before = structuredClone(state);
    const suspended = dispatch(state, ruleset, end(state, 'p1', 'post')).state;
    expect(suspended.phase).toBe('combat'); expect(suspended.revision).toBe(0); expect(suspended.effectState.pendingPostCommand).toBeDefined();
    const failed = dispatch(suspended, ruleset, consentCommand(suspended, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'share-request', response: 'accept' }, 'accept'));
    expect(failed.error?.code).toBe('INVALID_COMMAND'); expect(failed.state).toEqual(before); expect(state).toEqual(before);
  });

  it('rejects malformed Snapshot, unknown policy, and registry/version mismatch explicitly', () => {
    const ruleset = rules([hook('command-before', request())]); const state = game(ruleset, 2); const suspended = dispatch(state, ruleset, end(state)).state;
    const malformed = JSON.parse(JSON.stringify(serializeSnapshot(suspended))); malformed.state.effectState.pendingCounterConsent.acceptedActorIds = ['missing'];
    expect(() => restoreSnapshot(malformed, ruleset)).toThrow(/counter consent|invalid/i);
    const unknown = structuredClone(suspended); unknown.effectState.pendingCounterConsent!.policy.policyId = 'missing';
    expect(() => restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(unknown))), ruleset)).toThrow(/Unknown counter consent policy/);
    const mismatched = structuredClone(suspended); mismatched.effectState.pendingCounterConsent!.registry.modules[1]!.version = 'wrong';
    expect(() => restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(mismatched))), ruleset)).toThrow(/registry mismatch/);
    const input = { schemaVersion: 1 as const, action: 'accept' as const, actorId: 'p2', requestId: 'share-request', registry: { ...suspended.effectState.pendingCounterConsent!.registry, rulesetVersion: 'wrong' } };
    expect(evaluateCounterConsent(suspended, ruleset, input)).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
  });
});
