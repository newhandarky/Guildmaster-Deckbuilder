import { describe, expect, it } from 'vitest';
import type { DomainEvent, EffectDefinition, GameState, LifecycleHook } from '@guildmaster/game-protocol';
import { beginPostCommandPipeline, createGame, createRuleset, dispatch, envelope, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const modify = (amount: number): EffectDefinition['body'] => ({ kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount });
const choose = (id = 'post-choice', amount = 2): EffectDefinition['body'] => ({ kind: 'choice', choiceId: id, actor: { kind: 'controller' }, options: [{ id: 'accept', effect: modify(amount) }, { id: 'decline', effect: modify(0) }] });
const hook = (moduleId: string, hookId: string, point: LifecycleHook['point'], priority: number, body: EffectDefinition['body'], eventType?: string): LifecycleHook => ({ schemaVersion: 1, moduleId, hookId, point, kind: point === 'event-before' ? 'replacement' : 'trigger', priority, effect: { schemaVersion: 1, effectId: `${moduleId}:${hookId}`, body }, ...(eventType ? { eventType } : {}) });
const module = (id: string, hooks: readonly LifecycleHook[], version = '1'): RulesModule => ({ id, version, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: hooks });
const rules = (...modules: RulesModule[]) => createRuleset([testPack], [baseRulesModule, ...modules]);
const game = (ruleset: Ruleset) => createGame({ gameId: 'post-command-game', seed: 19, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
const end = (state: GameState) => envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'post-command');
const roundTrip = (state: GameState) => restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))));
const resolve = (state: GameState, ruleset: Ruleset, optionId = 'accept') => {
  const command = getLegalCommands(state, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.optionId === optionId)!;
  return dispatch(state, ruleset, envelope(state, 'p1', command));
};

describe('resumable post-command pipeline', () => {
  it.each([
    ['event-before', 'PHASE_ENDED'],
    ['event-after', 'PHASE_ENDED'],
    ['command-after', undefined]
  ] as const)('round-trips and resumes an exact %s cursor through the remaining boundaries', (point, eventType) => {
    const choiceHook = hook('test:choice', 'choose', point, 1, choose(), eventType);
    const afterEvent = hook('test:event-after', 'after-event', 'event-after', point === 'event-after' ? 2 : 1, modify(4), 'PHASE_ENDED');
    const afterCommand = hook('test:command-after', 'after-command', 'command-after', point === 'command-after' ? 2 : 1, modify(8));
    const ruleset = rules(module('test:choice', [choiceHook]), module('test:event-after', [afterEvent]), module('test:command-after', [afterCommand]));
    const initial = game(ruleset); const suspended = dispatch(initial, ruleset, end(initial));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.eventLogCursor).toBe(0);
    expect(suspended.state.effectState.pendingPostCommand).toMatchObject({ boundary: point, factIndex: point === 'command-after' ? 1 : 0, step: 'resume-boundary', continuationId: 'post-command:post-command' });
    const restored = roundTrip(suspended.state); expect(restored.effectState.pendingPostCommand).toEqual(suspended.state.effectState.pendingPostCommand);
    const completed = resolve(restored, ruleset);
    expect(completed.error).toBeUndefined(); expect(completed.state.phase).toBe('combat'); expect(completed.state.revision).toBe(1);
    expect(completed.state.eventLogCursor).toBe(completed.events.length); expect(completed.state.effectState).toEqual({});
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(14);
    expect(completed.events.filter(({ type }) => type === 'PHASE_ENDED')).toHaveLength(1);
    expect(new Set(completed.events.map(({ eventId }) => eventId)).size).toBe(completed.events.length);
  });

  it('continues the remaining hooks at one boundary without rerunning completed hooks', () => {
    const ruleset = rules(module('test:hooks', [
      hook('test:hooks', 'first', 'event-after', 1, modify(1), 'PHASE_ENDED'),
      hook('test:hooks', 'choice', 'event-after', 2, choose('middle', 2), 'PHASE_ENDED'),
      hook('test:hooks', 'last', 'event-after', 3, modify(4), 'PHASE_ENDED')
    ]));
    const state = game(ruleset); const suspended = dispatch(state, ruleset, end(state));
    expect(suspended.state.players[0]!.turnPurchaseBonus).toBe(1);
    const completed = resolve(roundTrip(suspended.state), ruleset);
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(7);
  });

  it('supports multiple consecutive choices while keeping one stable outer continuation', () => {
    const body: EffectDefinition['body'] = { kind: 'sequence', effects: [choose('first', 1), choose('second', 2)] };
    const ruleset = rules(module('test:twice', [hook('test:twice', 'twice', 'command-after', 1, body)]));
    const state = game(ruleset); const first = dispatch(state, ruleset, end(state));
    const firstId = first.state.effectState.pendingPostCommand!.continuationId;
    const second = resolve(roundTrip(first.state), ruleset);
    expect(second.error).toBeUndefined(); expect(second.state.revision).toBe(0); expect(second.state.effectState.pendingChoice?.choiceId).toBe('second'); expect(second.state.effectState.pendingPostCommand?.continuationId).toBe(firstId);
    const completed = resolve(roundTrip(second.state), ruleset);
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(3);
  });

  it('advances across multiple facts from the exact event-after cursor', () => {
    const ruleset = rules(
      module('test:first', [hook('test:first', 'choice', 'event-after', 1, choose(), 'FACT_ONE')]),
      module('test:second-before', [hook('test:second-before', 'before', 'event-before', 1, modify(4), 'FACT_TWO')]),
      module('test:second-after', [hook('test:second-after', 'after', 'event-after', 1, modify(8), 'FACT_TWO')]),
      module('test:command', [hook('test:command', 'after', 'command-after', 1, modify(16))])
    );
    const state = game(ruleset); const rollback = structuredClone(state); const original = end(state);
    const facts: DomainEvent[] = [
      { eventId: 'fact-1', revision: 1, type: 'FACT_ONE', message: 'one', causedByCommandId: original.commandId },
      { eventId: 'fact-2', revision: 1, type: 'FACT_TWO', message: 'two', causedByCommandId: original.commandId }
    ];
    const suspended = beginPostCommandPipeline(state, ruleset, original, rollback, facts, facts);
    expect(suspended.status).toBe('suspended'); expect(state.effectState.pendingPostCommand).toMatchObject({ factIndex: 0, boundary: 'event-after' });
    const completed = resolve(roundTrip(state), ruleset);
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(30);
    expect(completed.events.filter(({ type }) => type === 'FACT_ONE')).toHaveLength(1); expect(completed.events.filter(({ type }) => type === 'FACT_TWO')).toHaveLength(1);
  });

  it('normalizes helper-generated reducer facts and resumes after a rest command changes active player', () => {
    const ruleset = rules(module('test:draw-choice', [hook('test:draw-choice', 'draw', 'event-after', 1, choose(), 'CARD_DRAWN')]));
    const state = game(ruleset); state.phase = 'rest'; const player = state.players[0]!; const onlyCard = player.hand[0] ?? player.drawPile[0]!; const displaced = [...player.hand, ...player.playArea, ...player.discardPile, ...player.drawPile].filter((cardId) => cardId !== onlyCard); player.hand = []; player.playArea = []; player.discardPile = []; player.drawPile = [onlyCard]; state.removedCards.push(...displaced);
    const command = envelope(state, 'p1', { type: 'END_PHASE', phase: 'rest' }, 'finish-rest'); const suspended = dispatch(state, ruleset, command);
    expect(suspended.error).toBeUndefined(); expect(suspended.state.activePlayerId).toBe('p2'); expect(suspended.state.revision).toBe(0);
    expect(suspended.state.effectState.pendingPostCommand?.facts.find(({ type }) => type === 'CARD_DRAWN')?.causedByCommandId).toBe('finish-rest');
    const restored = roundTrip(suspended.state); expect(getLegalCommands(restored, ruleset, 'p1')).toHaveLength(2); expect(getLegalCommands(restored, ruleset, 'p2')).toEqual([]);
    const completed = resolve(restored, ruleset); expect(completed.error).toBeUndefined(); expect(completed.state.activePlayerId).toBe('p2'); expect(completed.state.revision).toBe(1); expect(completed.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(1);
  });

  it.each(['event-before', 'event-after', 'command-after'] as const)('rolls the entire command back when a later %s hook fails', (point) => {
    const eventType = point === 'command-after' ? undefined : 'PHASE_ENDED';
    const bad: EffectDefinition['body'] = { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } };
    const ruleset = rules(module(`test:${point}`, [hook(`test:${point}`, 'choice', point, 1, choose(), eventType), hook(`test:${point}`, 'bad', point, 2, bad, eventType)]));
    const initial = game(ruleset); const before = structuredClone(initial); const suspended = dispatch(initial, ruleset, end(initial));
    const failed = resolve(roundTrip(suspended.state), ruleset);
    expect(failed.error?.code).toBe('INVALID_COMMAND'); expect(failed.state).toEqual(before); expect(failed.events).toEqual([]);
  });

  it('preserves deterministic RNG and events across Snapshot and rolls RNG back on later failure', () => {
    const random: EffectDefinition['body'] = { kind: 'random', randomId: 'coin', outcomes: [{ id: 'one', effect: modify(1) }, { id: 'three', effect: modify(3) }] };
    const suspendRules = rules(module('test:random', [hook('test:random', 'random-choice', 'command-after', 1, { kind: 'sequence', effects: [random, choose()] })]));
    const left = dispatch(game(suspendRules), suspendRules, end(game(suspendRules))).state; const right = roundTrip(left);
    const leftDone = resolve(left, suspendRules); const rightDone = resolve(right, suspendRules);
    expect(rightDone.state).toEqual(leftDone.state); expect(rightDone.events).toEqual(leftDone.events);
    const bad: EffectDefinition['body'] = { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'removed' } };
    const failRules = rules(module('test:rng-fail', [hook('test:rng-fail', 'random', 'command-after', 1, random), hook('test:rng-fail', 'bad', 'command-after', 2, bad)]));
    const state = game(failRules); const before = structuredClone(state); const failed = dispatch(state, failRules, end(state));
    expect(failed.error?.code).toBe('INVALID_COMMAND'); expect(failed.state).toEqual(before);
  });

  it('rejects mismatched resolutions without changing the suspended state', () => {
    const ruleset = rules(module('test:choice', [hook('test:choice', 'choice', 'command-after', 1, choose())])); const initial = game(ruleset); const suspended = dispatch(initial, ruleset, end(initial)).state; const pending = suspended.effectState.pendingChoice!;
    const commands = [
      { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: 'wrong', choiceId: pending.choiceId, optionId: 'accept' },
      { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: pending.executionId, choiceId: 'wrong', optionId: 'accept' },
      { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'wrong' }
    ];
    for (const command of commands) { const state = structuredClone(suspended); const before = structuredClone(state); expect(dispatch(state, ruleset, envelope(state, 'p1', command)).error?.code).toBe('INVALID_COMMAND'); expect(state).toEqual(before); }
    const stale = dispatch(suspended, ruleset, { ...envelope(suspended, 'p1', commands[0]!), expectedRevision: 1 });
    const wrongGame = dispatch(suspended, ruleset, { ...envelope(suspended, 'p1', commands[0]!), gameId: 'wrong' });
    const wrongActor = dispatch(suspended, ruleset, { ...envelope(suspended, 'p1', commands[0]!), actorId: 'p2' });
    const blocked = dispatch(suspended, ruleset, envelope(suspended, 'p1', { type: 'END_PHASE', phase: 'combat' }));
    expect(stale.error?.code).toBe('STALE_REVISION'); expect(wrongGame.error?.code).toBe('STALE_REVISION'); expect(wrongActor.error?.code).toBe('NOT_AUTHORIZED'); expect(blocked.error?.code).toBe('INVALID_COMMAND');
  });

  it('rejects malformed Snapshot cursors, mismatched queues, and recursive checkpoints', () => {
    const ruleset = rules(module('test:choice', [hook('test:choice', 'choice', 'event-after', 1, choose(), 'PHASE_ENDED')])); const initial = game(ruleset); const suspended = dispatch(initial, ruleset, end(initial)).state;
    const mutations: ((state: GameState) => void)[] = [
      (state) => { state.effectState.pendingPostCommand!.factIndex = 9; },
      (state) => { state.effectState.pendingPostCommand!.boundary = 'command-after'; },
      (state) => { state.effectState.pendingPostCommand!.payload.eventType = 'WRONG'; },
      (state) => { state.effectState.pendingPostCommand!.context.controllerId = 'p2'; },
      (state) => { state.effectState.pendingPostCommand!.registry.rulesetVersion = 'wrong'; },
      (state) => { state.effectState.pendingPostCommand!.envelope.gameId = 'wrong'; },
      (state) => { state.effectState.pendingChoice!.executionId = 'wrong'; },
      (state) => { delete state.effectState.pendingChoice; },
      (state) => { delete state.effectState.pendingLifecycle; },
      (state) => { state.effectState.pendingPostCommand!.rollbackState.gameId = 'wrong'; },
      (state) => { state.effectState.pendingPostCommand!.rollbackState.effectState.pendingPostCommand = structuredClone(state.effectState.pendingPostCommand!); }
    ];
    for (const mutate of mutations) { const state = structuredClone(suspended); mutate(state); expect(() => roundTrip(state)).toThrow(); }
  });

  it('rolls back to the command start for unknown hooks and registry versions on resume', () => {
    const ruleset = rules(module('test:choice', [hook('test:choice', 'choice', 'command-after', 1, choose())])); const initial = game(ruleset); const suspended = dispatch(initial, ruleset, end(initial)).state;
    for (const mutate of [(state: GameState) => { state.effectState.pendingLifecycle!.currentHook.hookId = 'missing'; }, (state: GameState) => { state.effectState.pendingLifecycle!.registry.modules[1]!.version = 'wrong'; state.effectState.pendingPostCommand!.registry.modules[1]!.version = 'wrong'; }]) {
      const state = structuredClone(suspended); mutate(state); const failed = resolve(state, ruleset); expect(failed.error?.code).toBe('INVALID_COMMAND'); expect(failed.state).toEqual(initial);
    }
  });
});
