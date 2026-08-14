import { describe, expect, it } from 'vitest';
import type { RulesModule } from '../src/rules/ruleset.js';
import type { CombatRewardPolicy, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
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
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-reward'); expect(suspended.state.zones['base:monster-row']!.cardIds).toHaveLength(3); expect(suspended.state.enemyTargets[targetId]!.status).toBe('available');
    const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(suspended.state)));
    expect(() => restoreSnapshot(snapshot)).toThrow(/requires the active ruleset/);
    const restored = restoreSnapshot(snapshot, ruleset); const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE')!; const completed = dispatch(restored, ruleset, envelope(restored, 'p1', command));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(4); expect(completed.state.players[0]!.turnCombatBonus).toBe(1); expect(completed.state.zones['base:monster-row']!.cardIds).toHaveLength(3); expect(completed.events.filter((event) => event.type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(2); expect(completed.events.filter((event) => event.type === 'ENEMY_DEFEATED')).toHaveLength(1);
  });

  it('requires a ruleset and fails closed for tampered dynamic combat reward choices', () => {
    const dynamicChoice: EffectDefinition['body'] = {
      kind: 'choose-card',
      choiceId: 'reward-card-choice',
      actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' },
      predicate: { kind: 'definition-type-in', values: ['starter'] },
      selectedCardKey: 'selected',
      effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 },
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('dynamic-choice', { kind: 'always', value: true }, 1, dynamicChoice)])]);
    const state = game(ruleset);
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId);
    state.players[0]!.discardPile.push(equipmentId);
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: monster(state) }, 'dynamic-reward-root'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-reward');
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).not.toContain(equipmentId);
    const snapshot = serializeSnapshot(suspended.state);

    expect(() => restoreSnapshot(snapshot)).toThrow(/dynamic card choice Snapshot requires the active ruleset/);
    expect(restoreSnapshot(snapshot, ruleset)).toEqual(suspended.state);

    const tampered = structuredClone(snapshot);
    const pending = tampered.state.effectState.pendingChoice!;
    const option = pending.options[0]!;
    pending.options = [...pending.options, {
      ...structuredClone(option),
      id: equipmentId,
      context: { ...structuredClone(option.context!), cardRefs: { ...option.context!.cardRefs, selected: equipmentId } },
    }];
    expect(getLegalCommands(tampered.state, ruleset, 'p1')).toEqual([]);
    expect(() => restoreSnapshot(tampered, ruleset)).toThrow(/source zone and predicate/);
  });

  it('preserves the original command transaction when command-before and combat reward both suspend', () => {
    const beforeChoice: LifecycleHook = { schemaVersion: 1, moduleId: 'test:combined', hookId: 'before-choice', point: 'command-before', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'effect:before-choice', body: { kind: 'choice', choiceId: 'before-choice', actor: { kind: 'controller' }, options: [{ id: 'continue', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } }] } } };
    const rewardChoice = reward('reward-choice', { kind: 'always', value: true }, 1, { kind: 'choice', choiceId: 'reward-choice', actor: { kind: 'controller' }, options: [{ id: 'accept', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 } }] });
    const combined: RulesModule = { id: 'test:combined', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [beforeChoice], combatRewardPolicies: [{ ...rewardChoice, moduleId: 'test:combined' }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, combined]); const state = game(ruleset); const targetId = monster(state); const original = structuredClone(state);
    const beforeSuspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const beforeCommand = getLegalCommands(beforeSuspended.state, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.choiceId === 'before-choice')!;
    const rewardSuspended = dispatch(beforeSuspended.state, ruleset, envelope(beforeSuspended.state, 'p1', beforeCommand));
    expect(rewardSuspended.error).toBeUndefined(); expect(rewardSuspended.state.effectState.pendingCommand?.kind).toBe('combat-reward'); expect(rewardSuspended.state.revision).toBe(0);
    const rewardCommand = getLegalCommands(rewardSuspended.state, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.choiceId === 'reward-choice')!;
    const completed = dispatch(rewardSuspended.state, ruleset, envelope(rewardSuspended.state, 'p1', rewardCommand));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5); expect(completed.events.filter((event) => event.type === 'ENEMY_DEFEATED')).toHaveLength(1);
    expect(original.revision).toBe(0);
  });

  it('resumes an encounter node inside a CombatRewardPolicy effect without executing it twice', () => {
    const encounterPolicy = { schemaVersion: 1 as const, policyId: 'reward-encounter', moduleId: 'test:rewards', priority: 1, ordering: 'explicit-priority' as const, completionCondition: { kind: 'explicit-only' as const }, defeatedTargetDisposition: { kind: 'removed' as const }, removedTargetDisposition: { kind: 'removed' as const }, attachmentDisposition: { kind: 'removed' as const }, reasonCode: { namespace: 'test:rewards', code: 'encounter' } };
    const body: EffectDefinition['body'] = { kind: 'sequence', effects: [{ kind: 'create-enemy-encounter', encounterId: 'test:reward-encounter', encounterKind: 'test', rulesModuleId: 'test:rewards', policy: { moduleId: 'test:rewards', policyId: 'reward-encounter' } }, { kind: 'choice', choiceId: 'encounter-reward-choice', actor: { kind: 'controller' }, options: [{ id: 'continue', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 1 } }] }] };
    const combined: RulesModule = { ...module([reward('encounter', { kind: 'always', value: true }, 1, body)]), encounterResolutionPolicies: [encounterPolicy] };
    const ruleset = createRuleset([testPack], [baseRulesModule, combined]); const state = game(ruleset); const targetId = monster(state);
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-reward'); expect(suspended.state.enemyEncounters.filter(({ encounterId }) => encounterId === 'test:reward-encounter')).toHaveLength(1);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset); const choice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!; const completed = dispatch(restored, ruleset, envelope(restored, 'p1', choice));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyEncounters.filter(({ encounterId }) => encounterId === 'test:reward-encounter')).toHaveLength(1); expect(completed.events.filter(({ type }) => type === 'ENCOUNTER_CREATED')).toHaveLength(1);
  });
});
