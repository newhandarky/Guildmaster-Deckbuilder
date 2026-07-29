import { describe, expect, it } from 'vitest';
import type { RulesModule } from '../src/rules/ruleset.js';
import type { CombatRewardPolicy, EffectDefinition } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateCombatRewards, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import { testPack } from './fixtures.js';

const reward = (id: string, condition: CombatRewardPolicy['condition'], priority = 1, body: EffectDefinition['body'] = { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 }): CombatRewardPolicy => ({ schemaVersion: 1, rewardPolicyId: id, moduleId: 'test:rewards', priority, condition, recipient: 'defeating-player', reward: { schemaVersion: 1, effectId: `effect:${id}`, body } });
const module = (policies: readonly CombatRewardPolicy[]): RulesModule => ({ id: 'test:rewards', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', combatRewardPolicies: policies });
const game = (ruleset: ReturnType<typeof createRuleset>) => { const state = createGame({ gameId: 'rewards', seed: 9, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset); state.phase = 'combat'; return state; };
const monster = (state: ReturnType<typeof game>) => Object.values(state.enemyTargets).find((target) => target.kind === 'monster')!.targetId;

describe('generic combat reward policy evaluation', () => {
  it('returns a deterministic empty result without policies and never mutates state or RNG', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule]); const state = game(ruleset); const before = structuredClone(state);
    expect(evaluateCombatRewards(state, ruleset, 'p1', monster(state))).toMatchObject({ status: 'ready', evaluation: { matchedPolicies: [] } });
    expect(state).toEqual(before);
  });

  it('evaluates nested target, definition, encounter and counter conditions in explicit priority order', () => {
    const policies = [reward('first', { kind: 'all', conditions: [{ kind: 'target-kind-in', kinds: ['monster'] }, { kind: 'encounter-kind-in', kinds: ['base:enemies'] }] }, 1), reward('second', { kind: 'any', conditions: [{ kind: 'target-definition-id-in', definitionIds: ['test:monster/wolf'] }, { kind: 'player-counter-at-least', resourceId: 'token', amount: 2 }] }, 2)];
    const ruleset = createRuleset([testPack], [baseRulesModule, module(policies)]); const state = game(ruleset);
    expect(evaluateCombatRewards(state, ruleset, 'p1', monster(state))).toMatchObject({ status: 'ready', evaluation: { matchedPolicies: [{ rewardPolicyId: 'first' }, { rewardPolicyId: 'second' }] } });
    const ambiguous = createRuleset([testPack], [baseRulesModule, module([{ ...policies[0]!, priority: 1 }, { ...policies[1]!, priority: 1 }])]);
    expect(evaluateCombatRewards(state, ambiguous, 'p1', monster(state))).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
  });

  it('executes each matching policy once in the authoritative defeat transaction', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('purchase', { kind: 'target-kind-in', kinds: ['monster'] }, 1), reward('counter', { kind: 'always', value: true }, 2, { kind: 'modify-value', target: { kind: 'player-counter', player: { kind: 'controller' }, resourceId: 'reward' }, amount: 3 })])]); const state = game(ruleset); const targetId = monster(state);
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.turnPurchaseBonus).toBe(2); expect(result.state.players[0]!.counters).toContainEqual({ resourceId: 'reward', amount: 3, visibility: 'ownerOnly' }); expect(result.events.filter((event) => event.type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(2);
  });

  it('does not grant rewards for remove-target replacement and rolls back failed reward effects', () => {
    const replacement: RulesModule = { id: 'test:replacement', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', combatRules: [{ schemaVersion: 1, moduleId: 'test:replacement', ruleId: 'remove', priority: 1, kind: 'replacement', when: { kind: 'always', value: true }, outcome: { kind: 'remove-target' } }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, replacement, module([reward('always', { kind: 'always', value: true })])]); const state = game(ruleset); const removed = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: monster(state) }));
    expect(removed.events.some((event) => event.type === 'COMBAT_REWARD_POLICY_EXECUTED')).toBe(false);
    const bad = createRuleset([testPack], [baseRulesModule, module([reward('bad', { kind: 'always', value: true }, 1, { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } })])]); const failing = game(bad); const before = structuredClone(failing);
    expect(dispatch(failing, bad, envelope(failing, 'p1', { type: 'ATTACK_TARGET', targetId: monster(failing) })).error?.code).toBe('INVALID_COMMAND'); expect(failing).toEqual(before);
  });

  it('resumes a reward choice from a Snapshot without repeating the defeated target or reward policy', () => {
    const choice: EffectDefinition['body'] = { kind: 'choice', choiceId: 'reward-choice', actor: { kind: 'controller' }, options: [{ id: 'accept', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 4 } }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('choice', { kind: 'always', value: true }, 1, choice), reward('after', { kind: 'always', value: true }, 2, { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 1 })])]); const state = game(ruleset); const targetId = monster(state);
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-reward');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state)))); const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE')!; const completed = dispatch(restored, ruleset, envelope(restored, 'p1', command));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(4); expect(completed.state.players[0]!.turnCombatBonus).toBe(1); expect(completed.events.filter((event) => event.type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(2); expect(completed.events.filter((event) => event.type === 'ENEMY_DEFEATED')).toHaveLength(1);
  });
});
