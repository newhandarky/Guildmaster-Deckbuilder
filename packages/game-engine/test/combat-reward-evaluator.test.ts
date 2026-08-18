import { describe, expect, it } from 'vitest';
import type { RulesModule } from '../src/rules/ruleset.js';
import type { CombatRewardPolicy, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateCombatRewards, getCpuActionFeatures, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
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

  it('rejects dynamic reward choices whose shared source is missing or hidden at registration', () => {
    const body = (zoneId: string): EffectDefinition['body'] => ({ kind: 'choose-card', choiceId: `choice:${zoneId}`, actor: { kind: 'controller' }, from: { kind: 'shared-zone', zoneId }, selectedCardKey: 'selected', zeroCandidateBehavior: 'skip', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 } });
    expect(() => createRuleset([testPack], [baseRulesModule, module([reward('missing-zone', { kind: 'always', value: true }, 1, body('missing:zone'))])])).toThrow('unknown shared zone');
    expect(() => createRuleset([testPack], [baseRulesModule, module([reward('hidden-zone', { kind: 'always', value: true }, 1, body('base:item-deck'))])])).toThrow('must be public');
  });

  it('rejects shared-deck draws whose source is missing or is not an ordered deck', () => {
    const body = (sourceZoneId: string): EffectDefinition['body'] => ({ kind: 'draw-shared-deck', sourceZoneId, player: { kind: 'controller' }, destination: 'discardPile', count: 1 });
    expect(() => createRuleset([testPack], [baseRulesModule, module([reward('missing-deck', { kind: 'always', value: true }, 1, body('missing:deck'))])])).toThrow('unknown zone');
    expect(() => createRuleset([testPack], [baseRulesModule, module([reward('row-not-deck', { kind: 'always', value: true }, 1, body('base:item-row'))])])).toThrow('must be an ordered deck');
  });

  it('executes each matching policy once in the authoritative defeat transaction', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('purchase', { kind: 'target-kind-in', kinds: ['monster'] }, 1), reward('counter', { kind: 'always', value: true }, 2, { kind: 'modify-value', target: { kind: 'player-counter', player: { kind: 'controller' }, resourceId: 'reward' }, amount: 3 })])]); const state = game(ruleset); const targetId = monster(state);
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.turnPurchaseBonus).toBe(2); expect(result.state.players[0]!.counters).toContainEqual({ resourceId: 'reward', amount: 3, visibility: 'ownerOnly' }); expect(result.events.filter((event) => event.type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(2);
  });

  it('supports a zero-candidate combat-failure gate while preserving participant loss and resumable success', () => {
    const gate: EffectDefinition['body'] = {
      kind: 'choose-card',
      choiceId: 'post-combat-cost',
      decisionKind: 'discard-card',
      actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
      predicate: { kind: 'definition-type-in', values: ['adventurer'] },
      selectedCardKey: 'cost',
      zeroCandidateEffect: { kind: 'mark-combat-failed', reasonCode: 'REQUIRED_HAND_CARD_MISSING' },
      effect: { kind: 'sequence', effects: [
        { kind: 'discard-card', card: { kind: 'context-card', key: 'cost' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
      ] },
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('post-combat-gate', { kind: 'target-kind-in', kinds: ['monster'] }, 1, gate)])]);

    const failedState = game(ruleset); const failedTargetId = monster(failedState); failedState.players[0]!.turnCombatBonus = 2;
    const partyBefore = failedState.players[0]!.party.length; const participantId = failedState.players[0]!.party[0]!.adventurerId;
    expect(getCpuActionFeatures(failedState, ruleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === failedTargetId)).toMatchObject({ monsterDefeat: 0, honorGain: 0, immediatePurchasePower: 0 });
    const failed = dispatch(failedState, ruleset, envelope(failedState, 'p1', { type: 'ATTACK_TARGET', targetId: failedTargetId }, 'failed-gate'));
    expect(failed.error).toBeUndefined(); expect(failed.state.revision).toBe(1);
    expect(failed.state.enemyTargets[failedTargetId]!.status).toBe('available');
    expect(failed.state.players[0]!.party).toHaveLength(partyBefore - 1);
    expect(failed.state.players[0]!.discardPile).toContain(participantId);
    expect(failed.state.players[0]!.turnPurchaseBonus).toBe(0);
    expect(failed.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_FAILED', causedByCommandId: 'failed-gate' }));
    expect(failed.events.some(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toBe(false);

    const successState = game(ruleset); const successTargetId = monster(successState); successState.players[0]!.turnCombatBonus = 2;
    const row = successState.zones['base:adventurer-row']!;
    const costId = row.cardIds.shift()!; successState.players[0]!.hand.push(costId); successState.cards[costId]!.ownerId = 'p1';
    const suspended = dispatch(successState, ruleset, envelope(successState, 'p1', { type: 'ATTACK_TARGET', targetId: successTargetId }, 'success-gate'));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.effectState.pendingChoice).toMatchObject({ choiceId: 'post-combat-cost', decisionKind: 'discard-card' });
    const pending = suspended.state.effectState.pendingChoice!;
    const forged = dispatch(suspended.state, ruleset, envelope(suspended.state, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }, 'forged-gate'));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state).toEqual(successState);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const choice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === costId)!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', choice, 'resolve-gate'));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[successTargetId]!.status).toBe('defeated');
    expect(completed.state.players[0]!.discardPile).toContain(costId);
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(1);
  });

  it('stops reward continuation when a resumed choice marks combat failed', () => {
    const suspendedFailure: EffectDefinition['body'] = {
      kind: 'choice',
      choiceId: 'resumed-failure',
      actor: { kind: 'controller' },
      options: [{ id: 'fail', effect: { kind: 'mark-combat-failed', reasonCode: 'FAIL_AFTER_CHOICE' } }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module([
      reward('suspended-failure', { kind: 'always', value: true }, 1, suspendedFailure),
      reward('must-not-run', { kind: 'always', value: true }, 2, { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 99 }),
    ])]);
    const state = game(ruleset); const targetId = monster(state); state.players[0]!.turnCombatBonus = 2;
    const partyBefore = state.players[0]!.party.length;
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'resumed-failure-root'));
    expect(suspended.error).toBeUndefined();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const choice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.choiceId === 'resumed-failure')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', choice, 'resumed-failure-choice'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.enemyTargets[targetId]!.status).toBe('available');
    expect(completed.state.players[0]!.party).toHaveLength(partyBefore - 1);
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(0);
    expect(completed.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_FAILED', payload: expect.objectContaining({ reasonCode: 'FAIL_AFTER_CHOICE' }) }));
    expect(completed.events.some(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toBe(false);
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

  it('selects up to two qualifying public-row cards across a Snapshot continuation and skips an empty row', () => {
    const chooseSecond: EffectDefinition['body'] = {
      kind: 'choose-card',
      choiceId: 'public-reward-second',
      decisionKind: 'choose-market-card',
      actor: { kind: 'controller' },
      from: { kind: 'shared-zone', zoneId: 'base:item-row' },
      predicate: { kind: 'definition-cost-at-most', value: 2 },
      selectedCardKey: 'second',
      zeroCandidateBehavior: 'skip',
      effect: { kind: 'move-card', card: { kind: 'context-card', key: 'second' }, from: { kind: 'shared-zone', zoneId: 'base:item-row' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' }, transferOwnership: true },
    };
    const body: EffectDefinition['body'] = {
      kind: 'sequence',
      effects: [
        { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 5 },
        {
          kind: 'choose-card',
          choiceId: 'public-reward-first',
          decisionKind: 'choose-market-card',
          actor: { kind: 'controller' },
          from: { kind: 'shared-zone', zoneId: 'base:item-row' },
          predicate: { kind: 'definition-cost-at-most', value: 2 },
          selectedCardKey: 'first',
          zeroCandidateBehavior: 'skip',
          effect: { kind: 'sequence', effects: [
            { kind: 'move-card', card: { kind: 'context-card', key: 'first' }, from: { kind: 'shared-zone', zoneId: 'base:item-row' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'discardPile' }, transferOwnership: true },
            chooseSecond,
          ] },
        },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module([reward('public-row', { kind: 'always', value: true }, 1, body)])]);
    const state = game(ruleset); const targetId = monster(state); const initialRow = [...state.zones['base:item-row']!.cardIds];
    const first = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'public-row-root'));
    expect(first.error).toBeUndefined();
    expect(first.state.effectState.pendingChoice).toMatchObject({ choiceId: 'public-reward-first', decisionKind: 'choose-market-card' });
    expect(first.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual(initialRow);
    const firstCommand = getLegalCommands(first.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === initialRow[0])!;
    const second = dispatch(first.state, ruleset, envelope(first.state, 'p1', firstCommand));
    expect(second.error).toBeUndefined();
    expect(second.state.effectState.pendingChoice).toMatchObject({ choiceId: 'public-reward-second', decisionKind: 'choose-market-card' });
    expect(second.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual(initialRow.slice(1));
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(second.state))), ruleset);
    const secondCommand = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === initialRow[1])!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', secondCommand));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining(initialRow.slice(0, 2)));
    expect(completed.state.zones['base:item-row']!.cardIds).toEqual(initialRow.slice(2));
    expect(completed.state.cards[initialRow[0]!]!.ownerId).toBe('p1');
    expect(completed.state.cards[initialRow[1]!]!.ownerId).toBe('p1');

    const empty = game(ruleset); const emptyTargetId = monster(empty); const itemRow = empty.zones['base:item-row']!; empty.zones['base:item-deck']!.cardIds.push(...itemRow.cardIds.splice(0));
    const skipped = dispatch(empty, ruleset, envelope(empty, 'p1', { type: 'ATTACK_TARGET', targetId: emptyTargetId }, 'empty-public-row-root'));
    expect(skipped.error).toBeUndefined();
    expect(skipped.state.effectState.pendingChoice).toBeUndefined();
    expect(skipped.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(skipped.events.some(({ type }) => type === 'EFFECT_CHOICE_SKIPPED')).toBe(true);
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
