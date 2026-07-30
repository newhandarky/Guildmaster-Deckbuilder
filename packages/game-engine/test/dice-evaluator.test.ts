import { describe, expect, it } from 'vitest';
import type { EffectDefinition } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateDiceRoll, executeEffect, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const diceModule = (): RulesModule => ({ id: 'test:dice', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', diceDefinitions: [{ schemaVersion: 1, moduleId: 'test:dice', diceId: 'd6', sides: 6 }] });
const ruleset = () => createRuleset([testPack], [baseRulesModule, diceModule()]);
const game = (active: ReturnType<typeof ruleset>) => createGame({ gameId: 'dice', seed: 19, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, active);
const roll = (tail: EffectDefinition['body']): EffectDefinition => ({
  schemaVersion: 1,
  effectId: 'test:dice-roll',
  body: {
    kind: 'sequence',
    effects: [{
      kind: 'roll-die', moduleId: 'test:dice', diceId: 'd6',
      outcomes: Array.from({ length: 6 }, (_, index) => ({ face: index + 1, effect: { kind: 'modify-value' as const, target: { kind: 'turn-combat-bonus' as const, player: { kind: 'controller' as const } }, amount: index + 1 } }))
    }, tail]
  }
});

describe('generic dice roll runtime', () => {
  it('registers only owned, unique, finite JSON dice definitions', () => {
    expect(() => createRuleset([testPack], [baseRulesModule, { ...diceModule(), diceDefinitions: [{ schemaVersion: 1, moduleId: 'wrong', diceId: 'd6', sides: 6 }] }])).toThrow('must belong');
    expect(() => createRuleset([testPack], [baseRulesModule, { ...diceModule(), diceDefinitions: [{ schemaVersion: 1, moduleId: 'test:dice', diceId: 'd6', sides: 6 }, { schemaVersion: 1, moduleId: 'test:dice', diceId: 'd6', sides: 6 }] }])).toThrow('Duplicate dice');
  });

  it('evaluates deterministically without mutating RNG or state', () => {
    const active = ruleset(); const state = game(active); const registry = { rulesetVersion: state.rulesetVersion, modules: active.modules.map(({ id, version }) => ({ id, version })) }; const before = structuredClone(state);
    expect(evaluateDiceRoll(state, active, { schemaVersion: 1, moduleId: 'test:dice', diceId: 'd6', randomValue: 0.5, registry })).toMatchObject({ status: 'ready', evaluation: { face: 4 } });
    expect(state).toEqual(before);
    expect(evaluateDiceRoll(state, active, { schemaVersion: 1, moduleId: 'test:dice', diceId: 'missing', randomValue: 0.5, registry })).toMatchObject({ status: 'failed', reason: 'UNKNOWN_DIE' });
  });

  it('records a structured deterministic roll and rolls back RNG/events if a later node fails', () => {
    const active = ruleset(); const left = game(active); const right = game(active); const effect = roll({ kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 });
    const leftResult = executeEffect(left, active, effect, { controllerId: 'p1' }, 'dice'); const rightResult = executeEffect(right, active, effect, { controllerId: 'p1' }, 'dice');
    expect(leftResult.events.find(({ type }) => type === 'DIE_ROLLED')?.payload).toMatchObject({ kind: 'dice-roll', evaluation: { input: { diceId: 'd6' } } }); expect(left).toEqual(right); expect(leftResult.events).toEqual(rightResult.events);
    const failed = game(active); const before = structuredClone(failed); const invalid = roll({ kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'removed' } });
    expect(executeEffect(failed, active, invalid, { controllerId: 'p1' }, 'bad').status).toBe('failed'); expect(failed).toEqual(before);
  });

  it('round-trips a choice after a roll without rerolling', () => {
    const active = ruleset(); const state = game(active); const effect = roll({ kind: 'choice', choiceId: 'continue', actor: { kind: 'controller' }, options: [{ id: 'ok', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 } }] });
    expect(executeEffect(state, active, effect, { controllerId: 'p1' }, 'choice').status).toBe('suspended'); const rng = state.rngState; const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), active);
    expect(restored.effectState.pendingChoice).toBeDefined(); expect(restored.rngState).toBe(rng);
    const resolve = getLegalCommands(restored, active, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE');
    expect(resolve).toBeDefined();
    const result = dispatch(restored, active, envelope(restored, 'p1', resolve!));
    expect(result.error).toBeUndefined(); expect(result.events.some(({ type }) => type === 'DIE_ROLLED')).toBe(false); expect(restored.rngState).toBe(rng);
  });
});
