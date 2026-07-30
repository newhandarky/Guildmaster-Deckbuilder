import { describe, expect, it } from 'vitest';
import type { CombatRule, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateCombat, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const module = (id: string, combatRules: readonly CombatRule[], version = '1'): RulesModule => ({ id, version, combatRules, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled' });
const rules = (...modules: RulesModule[]) => createRuleset([testPack], [baseRulesModule, ...modules]);
const game = (ruleset: Ruleset) => createGame({ gameId: 'combat-evaluation', seed: 23, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
const target = (state: ReturnType<typeof game>) => Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
const modifier = (moduleId: string, ruleId: string, amount: number, priority?: number): Extract<CombatRule, { kind: 'modifier' }> => ({ schemaVersion: 1, moduleId, ruleId, kind: 'modifier', amount, when: { kind: 'target-kind-in', kinds: ['monster'] }, ...(priority === undefined ? {} : { priority }) });
const lifecycle = (moduleId: string, hookId: string, body: EffectDefinition['body']): LifecycleHook => ({ schemaVersion: 1, moduleId, hookId, point: 'command-before', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: `${moduleId}:${hookId}`, body } });

describe('generic combat evaluation pipeline', () => {
  it('applies positive and negative modifiers without mutating evaluation inputs', () => {
    const ruleset = rules(module('test:modifiers', [modifier('test:modifiers', 'discount', -1, 1), modifier('test:modifiers', 'tax', 2, 2)]));
    const state = game(ruleset); state.phase = 'combat'; const before = structuredClone(state); const result = evaluateCombat(state, ruleset, 'p1', target(state));
    expect(result).toMatchObject({ status: 'ready', evaluation: { requiredCombat: 4, eligible: true, appliedRules: [{ ruleId: 'discount' }, { ruleId: 'tax' }] } }); expect(state).toEqual(before);
  });

  it('uses the same evaluation for legal commands and authoritative dispatch', () => {
    const ruleset = rules(module('test:hard', [modifier('test:hard', 'too-hard', 3)])); const state = game(ruleset); state.phase = 'combat'; const targetId = target(state);
    state.players[0]!.party.splice(3);
    expect(getLegalCommands(state, ruleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId });
    const before = structuredClone(state); const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.state).toEqual(before);
  });

  it('previews synchronous command-before mutations for both legal commands and dispatch', () => {
    const restriction: CombatRule = { schemaVersion: 1, moduleId: 'test:before-restrict', ruleId: 'counter-lock', kind: 'restriction', reasonCode: 'COUNTER_LOCKED', when: { kind: 'player-counter-at-least', resourceId: 'test:lock', amount: 1 } };
    const restrictHook = lifecycle('test:before-restrict', 'lock-before-attack', { kind: 'modify-value', target: { kind: 'player-counter', player: { kind: 'controller' }, resourceId: 'test:lock' }, amount: 1 });
    const restrictedRuleset = rules({ ...module('test:before-restrict', [restriction]), lifecycleHooks: [restrictHook] }); const restricted = game(restrictedRuleset); restricted.phase = 'combat'; const restrictedTarget = target(restricted); const before = structuredClone(restricted);
    expect(getLegalCommands(restricted, restrictedRuleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: restrictedTarget });
    expect(dispatch(restricted, restrictedRuleset, envelope(restricted, 'p1', { type: 'ATTACK_TARGET', targetId: restrictedTarget })).state).toEqual(before);

    const boostHook = lifecycle('test:before-boost', 'boost-before-attack', { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 3 });
    const boostedRuleset = rules({ ...module('test:before-boost', [modifier('test:before-boost', 'harder', 3)]), lifecycleHooks: [boostHook] }); const boosted = game(boostedRuleset); boosted.phase = 'combat'; const trimmed = boosted.players[0]!.party.splice(3); boosted.players[0]!.discardPile.push(...trimmed.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])); const boostedTarget = target(boosted);
    expect(getLegalCommands(boosted, boostedRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: boostedTarget });
    expect(dispatch(boosted, boostedRuleset, envelope(boosted, 'p1', { type: 'ATTACK_TARGET', targetId: boostedTarget })).error).toBeUndefined();
  });

  it('previews command-before choice branches and exposes only completable resolutions after Snapshot restore', () => {
    const body: EffectDefinition['body'] = { kind: 'choice', choiceId: 'prepare-combat', actor: { kind: 'controller' }, options: [
      { id: 'stay', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } },
      { id: 'boost', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 3 } }
    ] };
    const hook = lifecycle('test:choice-before', 'prepare', body);
    const ruleset = rules({ ...module('test:choice-before', [modifier('test:choice-before', 'harder', 3)]), lifecycleHooks: [hook] }); const state = game(ruleset); state.phase = 'combat'; const trimmed = state.players[0]!.party.splice(3); state.players[0]!.discardPile.push(...trimmed.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])); const targetId = target(state);
    expect(getLegalCommands(state, ruleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))));
    expect(getLegalCommands(restored, ruleset, 'p1')).toEqual([{ type: 'RESOLVE_EFFECT_CHOICE', executionId: restored.effectState.pendingChoice!.executionId, choiceId: 'prepare-combat', optionId: 'boost' }]);
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', getLegalCommands(restored, ruleset, 'p1')[0]!)); expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated'); expect(completed.state.revision).toBe(1);

    const impossible = game(ruleset); impossible.phase = 'combat'; const removedParty = impossible.players[0]!.party.splice(0); impossible.players[0]!.discardPile.push(...removedParty.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])); const impossibleTarget = target(impossible);
    expect(getLegalCommands(impossible, ruleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: impossibleTarget });
    expect(getLegalCommands(impossible, ruleset, 'p1')).toContainEqual({ type: 'END_PHASE', phase: 'combat' });

    const nestedChoice = (depth: number): EffectDefinition['body'] => depth === 0
      ? { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 3 }
      : { kind: 'choice', choiceId: `deep-${depth}`, actor: { kind: 'controller' }, options: [{ id: 'continue', effect: nestedChoice(depth - 1) }] };
    const deepRuleset = rules({ ...module('test:deep-choice', [modifier('test:deep-choice', 'harder', 3)]), lifecycleHooks: [lifecycle('test:deep-choice', 'prepare', nestedChoice(34))] }); const deep = game(deepRuleset); deep.phase = 'combat'; const deepTrimmed = deep.players[0]!.party.splice(3); deep.players[0]!.discardPile.push(...deepTrimmed.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])])); const deepTarget = target(deep);
    expect(getLegalCommands(deep, deepRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: deepTarget });
    const deepSuspended = dispatch(deep, deepRuleset, envelope(deep, 'p1', { type: 'ATTACK_TARGET', targetId: deepTarget }));
    expect(getLegalCommands(deepSuspended.state, deepRuleset, 'p1')).toHaveLength(1);
  });

  it('orders active rules across modules and rejects ambiguous priorities atomically', () => {
    const ordered = rules(module('test:first', [modifier('test:first', 'first', -1, 1)]), module('test:last', [modifier('test:last', 'last', 2, 2)])); const orderedState = game(ordered); orderedState.phase = 'combat';
    expect(evaluateCombat(orderedState, ordered, 'p1', target(orderedState))).toMatchObject({ status: 'ready', evaluation: { appliedRules: [{ moduleId: 'test:first' }, { moduleId: 'test:last' }] } });
    const ambiguous = rules(module('test:a', [modifier('test:a', 'a', 1, 1)]), module('test:b', [modifier('test:b', 'b', 1, 1)])); const state = game(ambiguous); state.phase = 'combat'; const before = structuredClone(state); const targetId = target(state);
    expect(evaluateCombat(state, ambiguous, 'p1', targetId)).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(getLegalCommands(state, ambiguous, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(dispatch(state, ambiguous, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })).state).toEqual(before);
  });

  it('applies target restrictions consistently in query and dispatch', () => {
    const restriction: CombatRule = { schemaVersion: 1, moduleId: 'test:restriction', ruleId: 'sealed', kind: 'restriction', reasonCode: 'TARGET_SEALED', when: { kind: 'target-kind-in', kinds: ['monster'] } };
    const ruleset = rules(module('test:restriction', [restriction])); const state = game(ruleset); state.phase = 'combat'; const targetId = target(state); const before = structuredClone(state);
    expect(evaluateCombat(state, ruleset, 'p1', targetId)).toMatchObject({ status: 'ready', evaluation: { eligible: false, restrictionReasonCodes: ['TARGET_SEALED'] } });
    expect(getLegalCommands(state, ruleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })).state).toEqual(before);
  });

  it('executes a data-driven remove-target replacement instead of the base defeat outcome', () => {
    const replacement: CombatRule = { schemaVersion: 1, moduleId: 'test:replacement', ruleId: 'banish', kind: 'replacement', outcome: { kind: 'remove-target' }, when: { kind: 'target-kind-in', kinds: ['monster'] } };
    const ruleset = rules(module('test:replacement', [replacement])); const state = game(ruleset); state.phase = 'combat'; const targetId = target(state); const cardId = state.enemyTargets[targetId]!.cardInstanceId;
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined(); expect(result.state.enemyTargets[targetId]!.status).toBe('removed'); expect(result.state.removedCards).toContain(cardId);
    expect(result.state.players[0]!.history.defeatedMonsters).toBe(0); expect(result.events.some(({ type }) => type === 'ENEMY_REMOVED')).toBe(true); expect(result.events.some(({ type }) => type === 'ENEMY_DEFEATED')).toBe(false);
  });

  it('uses explicit replacement order and keeps the highest-priority active outcome', () => {
    const low: CombatRule = { schemaVersion: 1, moduleId: 'test:replacement-order', ruleId: 'remove', kind: 'replacement', priority: 1, outcome: { kind: 'remove-target' }, when: { kind: 'always', value: true } };
    const high: CombatRule = { schemaVersion: 1, moduleId: 'test:replacement-order', ruleId: 'defeat', kind: 'replacement', priority: 2, outcome: { kind: 'defeat-target' }, when: { kind: 'always', value: true } };
    const ruleset = rules(module('test:replacement-order', [low, high])); const state = game(ruleset); state.phase = 'combat';
    expect(evaluateCombat(state, ruleset, 'p1', target(state))).toMatchObject({ status: 'ready', evaluation: { outcome: { kind: 'defeat-target' }, appliedRules: [{ ruleId: 'remove' }, { ruleId: 'defeat' }] } });
  });

  it('keeps combat evaluation facts compatible with post-command choice continuation', () => {
    const choice: EffectDefinition['body'] = { kind: 'choice', choiceId: 'combat-audit', actor: { kind: 'controller' }, options: [{ id: 'accept', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 } }] };
    const lifecycle: LifecycleHook = { schemaVersion: 1, moduleId: 'test:combined', hookId: 'after-evaluation', point: 'event-after', eventType: 'COMBAT_EVALUATED', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'test:combat-audit', body: choice } };
    const combined: RulesModule = { ...module('test:combined', [modifier('test:combined', 'discount', -1)]), lifecycleHooks: [lifecycle] };
    const ruleset = rules(combined); const state = game(ruleset); state.phase = 'combat'; const targetId = target(state); const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingPostCommand).toMatchObject({ boundary: 'event-after', factIndex: 0 });
    expect(suspended.state.effectState.pendingPostCommand?.facts[0]?.payload).toMatchObject({ kind: 'combat-evaluation', evaluation: { requiredCombat: 2, outcome: { kind: 'defeat-target' }, appliedRules: [{ moduleId: 'test:combined', ruleId: 'discount' }] } });
    const missingPayload = structuredClone(serializeSnapshot(suspended.state)); delete missingPayload.state.effectState.pendingPostCommand!.facts[0]!.payload;
    expect(() => restoreSnapshot(missingPayload)).toThrow();
    const mismatchedRegistry = structuredClone(serializeSnapshot(suspended.state)); const factPayload = mismatchedRegistry.state.effectState.pendingPostCommand!.facts[0]!.payload; const eventPayload = mismatchedRegistry.state.effectState.pendingPostCommand!.events.find(({ type }) => type === 'COMBAT_EVALUATED')!.payload; if (!factPayload || factPayload.kind !== 'combat-evaluation' || !eventPayload || eventPayload.kind !== 'combat-evaluation') throw new Error('missing combat payload'); factPayload.evaluation.registry.modules[1]!.version = 'tampered'; eventPayload.evaluation.registry.modules[1]!.version = 'tampered';
    expect(() => restoreSnapshot(mismatchedRegistry)).toThrow('combat evaluation registry mismatch');
    const duplicateId = structuredClone(serializeSnapshot(suspended.state)); const duplicate = structuredClone(duplicateId.state.effectState.pendingPostCommand!.facts[0]!); duplicate.message = 'tampered duplicate'; duplicateId.state.effectState.pendingPostCommand!.events = [...duplicateId.state.effectState.pendingPostCommand!.events, duplicate];
    expect(() => restoreSnapshot(duplicateId)).toThrow('event IDs must be unique');
    const duplicateFact = structuredClone(serializeSnapshot(suspended.state)); duplicateFact.state.effectState.pendingPostCommand!.facts = [duplicateFact.state.effectState.pendingPostCommand!.facts[0]!, ...duplicateFact.state.effectState.pendingPostCommand!.facts];
    expect(() => restoreSnapshot(duplicateFact)).toThrow('fact IDs must be unique');
    const truncatedFacts = structuredClone(serializeSnapshot(suspended.state)); truncatedFacts.state.effectState.pendingPostCommand!.facts = truncatedFacts.state.effectState.pendingPostCommand!.facts.slice(0, -1);
    expect(() => restoreSnapshot(truncatedFacts)).toThrow('complete ordered reducer fact segment');
    const reorderedFacts = structuredClone(serializeSnapshot(suspended.state)); reorderedFacts.state.effectState.pendingPostCommand!.facts = [...reorderedFacts.state.effectState.pendingPostCommand!.facts].reverse(); reorderedFacts.state.effectState.pendingPostCommand!.factIndex = reorderedFacts.state.effectState.pendingPostCommand!.facts.findIndex(({ type }) => type === 'COMBAT_EVALUATED');
    expect(() => restoreSnapshot(reorderedFacts)).toThrow('complete ordered reducer fact segment');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state)))); const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE')!; const completed = dispatch(restored, ruleset, envelope(restored, 'p1', command));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated'); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(2); expect(completed.events.filter(({ type }) => type === 'COMBAT_EVALUATED')).toHaveLength(1);
    expect(completed.events.find(({ type }) => type === 'COMBAT_EVALUATED')?.payload).toEqual(suspended.state.effectState.pendingPostCommand?.facts[0]?.payload);
  });

  it('rejects unknown or version-mismatched registries without state or RNG mutation', () => {
    const ruleset = rules(module('test:modifier', [modifier('test:modifier', 'bonus', 1)])); const original = game(ruleset); original.phase = 'combat'; const targetId = target(original);
    for (const mutate of [(state: typeof original) => { state.rulesModules.pop(); }, (state: typeof original) => { state.rulesModules[1]!.version = 'wrong'; }]) {
      const state = structuredClone(original); mutate(state); const before = structuredClone(state); const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.state).toEqual(before); expect(result.state.rngState).toBe(before.rngState);
    }
  });

  it('is deterministic across Snapshot round-trips and leaves RNG untouched', () => {
    const condition: CombatRule = { schemaVersion: 1, moduleId: 'test:counter', ruleId: 'counter-bonus', kind: 'modifier', amount: -2, when: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'combat' }, { kind: 'player-counter-at-least', resourceId: 'test:token', amount: 2 }] } };
    const ruleset = rules(module('test:counter', [condition])); const left = game(ruleset); left.phase = 'combat'; left.players[0]!.counters.push({ resourceId: 'test:token', amount: 2, visibility: 'ownerOnly' }); const right = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(left)))); const rng = left.rngState;
    expect(evaluateCombat(right, ruleset, 'p1', target(right))).toEqual(evaluateCombat(left, ruleset, 'p1', target(left))); expect(left.rngState).toBe(rng); expect(right.rngState).toBe(rng);
  });

  it('validates IDs, ownership, JSON-only data, conditions, and priorities at registration', () => {
    expect(() => rules(module('test:bad', [{ ...modifier('wrong', 'bad', 1), amount: Number.NaN }]))).toThrow();
    expect(() => rules(module('test:duplicate', [modifier('test:duplicate', 'same', 1), modifier('test:duplicate', 'same', 2)]))).toThrow('Duplicate combat rule');
    const callback = modifier('test:function', 'function', 1) as CombatRule & { callback: () => void }; callback.callback = () => undefined;
    expect(() => rules(module('test:function', [callback]))).toThrow('JSON-serializable');
    expect(() => rules(module('test:unknown-rule', [{ ...modifier('test:unknown-rule', 'unknown', 1), kind: 'mystery' } as unknown as CombatRule]))).toThrow('invalid runtime data');
    expect(() => rules(module('test:unknown-condition', [{ ...modifier('test:unknown-condition', 'unknown', 1), when: { kind: 'mystery' } } as unknown as CombatRule]))).toThrow('invalid runtime data');
    expect(() => rules(module('test:unknown-outcome', [{ schemaVersion: 1, moduleId: 'test:unknown-outcome', ruleId: 'unknown', kind: 'replacement', when: { kind: 'always', value: true }, outcome: { kind: 'mystery' } } as unknown as CombatRule]))).toThrow('invalid runtime data');
    expect(() => rules(module('test:blank', [{ ...modifier('test:blank', 'blank', 1), ruleId: '   ' }]))).toThrow('invalid runtime data');
    const cyclic = { kind: 'not' } as { kind: 'not'; condition: unknown }; cyclic.condition = cyclic;
    expect(() => rules(module('test:cyclic', [{ ...modifier('test:cyclic', 'cyclic', 1), when: cyclic } as unknown as CombatRule]))).toThrow('acyclic');
  });

  it('rejects combat modifier overflow atomically', () => {
    const ruleset = rules(module('test:overflow', [modifier('test:overflow', 'first', Number.MAX_VALUE, 1), modifier('test:overflow', 'second', Number.MAX_VALUE, 2)])); const state = game(ruleset); state.phase = 'combat'; const targetId = target(state); const before = structuredClone(state);
    expect(evaluateCombat(state, ruleset, 'p1', targetId)).toMatchObject({ status: 'failed', reason: 'INVALID_COMBAT_VALUE' });
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.state).toEqual(before); expect(result.events).toEqual([]);
  });
});
