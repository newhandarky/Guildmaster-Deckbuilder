import { describe, expect, it } from 'vitest';
import type { EffectDefinition, EncounterResolutionPolicy, GameState, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, dispatchLifecycle, envelope, evaluateEncounterCompletion, executeEffect, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const policy = (completionCondition: EncounterResolutionPolicy['completionCondition'], overrides: Partial<EncounterResolutionPolicy> = {}): EncounterResolutionPolicy => ({
  schemaVersion: 1, policyId: 'all', moduleId: 'test:encounter', priority: 1, ordering: 'explicit-priority', completionCondition,
  defeatedTargetDisposition: { kind: 'removed' }, removedTargetDisposition: { kind: 'removed' }, attachmentDisposition: { kind: 'removed' }, reasonCode: { namespace: 'test:encounter', code: 'complete' }, ...overrides
});
const rules = (entry = policy({ kind: 'all-targets-terminal' })): RulesModule => ({ id: 'test:encounter', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', encounterResolutionPolicies: [entry] });
const ruleset = (entry?: EncounterResolutionPolicy) => createRuleset([testPack], [baseRulesModule, rules(entry)]);
const game = (entry?: EncounterResolutionPolicy) => createGame({ gameId: 'encounter', seed: 1, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset(entry));
const ref = { moduleId: 'test:encounter', policyId: 'all' } as const;
const source = (cardId: string, zoneId = 'base:monster-deck') => ({ card: { kind: 'card-instance' as const, cardInstanceId: cardId }, from: { kind: 'shared-zone' as const, zoneId } });
const createEncounter = { kind: 'create-enemy-encounter' as const, encounterId: 'test:e', encounterKind: 'test', rulesModuleId: 'test:encounter', policy: ref };
const target = (id: string, cardId: string, partKey: string, health = 2, zoneId = 'base:monster-deck') => ({ kind: 'create-enemy-target' as const, targetId: id, encounterId: 'test:e', ...source(cardId, zoneId), targetKind: 'part', partKey, health: { current: health, max: health } });
const run = (state: ReturnType<typeof game>, body: EffectDefinition['body'], entry?: EncounterResolutionPolicy) => executeEffect(state, ruleset(entry), { schemaVersion: 1, effectId: 'test:encounter', body }, { controllerId: 'p1' }, 'encounter-test');
const ordinaryMonsterCard = (state: GameState): string => state.zones['base:monster-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:monster/wolf')!;

describe('generic multi-target encounter runtime', () => {
  it('creates multiple targets, applies partial/lethal damage, and completes all-targets-terminal exactly once', () => {
    const state = game(); const first = ordinaryMonsterCard(state); const second = state.zones['base:item-deck']!.cardIds[0]!;
    const partial = run(state, { kind: 'sequence', effects: [createEncounter, target('left', first, 'left', 3), target('right', second, 'right', 2, 'base:item-deck'), { kind: 'damage-enemy-target', targetId: 'left', amount: 1, policy: ref }] });
    expect(partial.error).toBeUndefined(); expect(partial.status).toBe('completed'); expect(state.enemyTargets.left!.health).toEqual({ current: 2, max: 3 });
    const result = run(state, { kind: 'sequence', effects: [{ kind: 'damage-enemy-target', targetId: 'right', amount: 2, policy: ref }, { kind: 'damage-enemy-target', targetId: 'left', amount: 2, policy: ref }] });
    expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
    expect(state.enemyTargets.left!.status).toBe('defeated'); expect(state.enemyTargets.right!.status).toBe('defeated');
    expect(state.enemyEncounters.find(({ encounterId }) => encounterId === 'test:e')!.status).toBe('finished');
    expect(result.events.filter(({ type }) => type === 'ENCOUNTER_COMPLETED')).toHaveLength(1);
    expect(run(state, { kind: 'defeat-enemy-target', targetId: 'left', policy: ref }).status).toBe('failed');
  });

  it('moves target and attachment cards according to module/shared destination ordering', () => {
    const entry = policy({ kind: 'all-targets-defeated' }, {
      defeatedTargetDisposition: { kind: 'shared-zone', zoneId: 'test:resolved', position: 'bottom', ordering: 'preserve' },
      attachmentDisposition: { kind: 'module-zone', zoneId: 'test:attachments', position: 'top', ordering: 'reverse' }
    });
    const state = game(entry); const seed = state.zones['base:item-deck']!.cardIds[1]!; state.zones['base:item-deck']!.cardIds.splice(1, 1); state.zones['test:resolved'] = { zoneId: 'test:resolved', kind: 'faceUpRow', cardIds: [seed], visibility: 'public' };
    state.zones['test:attachments'] = { zoneId: 'test:attachments', kind: 'moduleArea', cardIds: [], visibility: 'public', rulesModuleId: 'test:encounter' };
    const body = ordinaryMonsterCard(state); const attachment = state.zones['base:item-deck']!.cardIds[0]!;
    const result = run(state, { kind: 'sequence', effects: [createEncounter, target('core', body, 'core'), { kind: 'attach-card-to-enemy-target', targetId: 'core', ...source(attachment, 'base:item-deck'), position: 'top' }, { kind: 'defeat-enemy-target', targetId: 'core', policy: ref }] }, entry);
    expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
    expect(state.zones['test:resolved']!.cardIds).toEqual([body, seed]);
    expect(state.zones['test:attachments']!.cardIds).toEqual([attachment]);
    expect(state.enemyTargets.core!.attachments).toEqual([]);
  });

  it('cleans target-leave combat modifiers when a generic encounter target becomes terminal', () => {
    const state = game(); const card = ordinaryMonsterCard(state);
    expect(run(state, { kind: 'sequence', effects: [createEncounter, target('core', card, 'core')] }).status).toBe('completed');
    state.temporaryTargetModifiers = [{ modifierId: 'until-core-leaves', moduleId: 'test:encounter', targetCardId: card, amount: -1, expiresWhenTargetLeaves: true }];
    const result = run(state, { kind: 'defeat-enemy-target', targetId: 'core', policy: ref });
    expect(result.status).toBe('completed');
    expect(state.enemyTargets.core!.status).toBe('defeated');
    expect(state.temporaryTargetModifiers).toEqual([]);
  });

  it('applies reverse ordering to multiple attachments and sends owned attachments to player discard', () => {
    const entry = policy({ kind: 'all-targets-defeated' }, { attachmentDisposition: { kind: 'player-discard', position: 'top', ordering: 'reverse' } });
    const state = game(entry); const body = ordinaryMonsterCard(state); const [first, second] = state.players[0]!.hand.slice(0, 2);
    const hand = (cardId: string) => ({ card: { kind: 'card-instance' as const, cardInstanceId: cardId }, from: { kind: 'player-zone' as const, player: { kind: 'controller' as const }, zone: 'hand' as const } });
    const result = run(state, { kind: 'sequence', effects: [createEncounter, target('core', body, 'core'), { kind: 'attach-card-to-enemy-target', targetId: 'core', ...hand(first!), position: 'top' }, { kind: 'attach-card-to-enemy-target', targetId: 'core', ...hand(second!), position: 'top' }, { kind: 'defeat-enemy-target', targetId: 'core', policy: ref }] }, entry);
    expect(result.status).toBe('completed'); expect(state.players[0]!.discardPile.slice(-2)).toEqual([second, first]);
  });

  it.each([
    [policy({ kind: 'all-targets-defeated' }), false],
    [policy({ kind: 'all-targets-terminal' }), true],
    [policy({ kind: 'required-targets-defeated', match: 'all', partKeys: ['left', 'right'] }), false],
    [policy({ kind: 'required-targets-defeated', match: 'any', partKeys: ['left', 'right'] }), true]
  ])('uses declared completion condition %#', (entry, expectedFinished) => {
    const state = game(entry); const first = ordinaryMonsterCard(state); const second = state.zones['base:item-deck']!.cardIds[0]!;
    const terminalEffects: EffectDefinition['body'][] = entry.completionCondition.kind === 'required-targets-defeated' && entry.completionCondition.match === 'any'
      ? [{ kind: 'defeat-enemy-target', targetId: 'left', policy: ref }]
      : [{ kind: 'defeat-enemy-target', targetId: 'left', policy: ref }, { kind: 'remove-enemy-target', targetId: 'right', policy: ref }];
    const result = run(state, { kind: 'sequence', effects: [createEncounter, target('left', first, 'left'), { kind: 'create-enemy-target', targetId: 'right', encounterId: 'test:e', ...source(second, 'base:item-deck'), targetKind: 'part', partKey: 'right', health: { current: 2, max: 2 } }, ...terminalEffects] }, entry);
    expect(result.status).toBe('completed'); expect(state.enemyEncounters.find(({ encounterId }) => encounterId === 'test:e')!.status === 'finished').toBe(expectedFinished);
  });

  it('supports explicit-only finish and rolls a failed sequence back atomically', () => {
    const entry = policy({ kind: 'explicit-only' }); const state = game(entry); const before = structuredClone(state); const card = ordinaryMonsterCard(state);
    const failed = run(state, { kind: 'sequence', effects: [createEncounter, target('core', card, 'core'), { kind: 'damage-enemy-target', targetId: 'missing', amount: 1, policy: ref }] }, entry);
    expect(failed.status).toBe('failed'); expect(state).toEqual(before);
    const completed = run(state, { kind: 'sequence', effects: [createEncounter, target('core', card, 'core'), { kind: 'finish-enemy-encounter', encounterId: 'test:e', policy: ref }] }, entry);
    expect(completed.status).toBe('completed'); expect(state.enemyEncounters.find(({ encounterId }) => encounterId === 'test:e')!.status).toBe('finished');
  });

  it('round-trips a choice after encounter damage without replaying damage or deterministic RNG', () => {
    const state = game(); const card = ordinaryMonsterCard(state);
    const body: EffectDefinition['body'] = { kind: 'sequence', effects: [createEncounter, target('core', card, 'core', 3), { kind: 'random', randomId: 'once', outcomes: [{ id: 'hit', effect: { kind: 'damage-enemy-target', targetId: 'core', amount: 1, policy: ref } }] }, { kind: 'choice', choiceId: 'continue', actor: { kind: 'controller' }, options: [{ id: 'yes', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 1 } }] }, { kind: 'damage-enemy-target', targetId: 'core', amount: 2, policy: ref }] };
    expect(run(state, body).status).toBe('suspended'); const rng = state.rngState;
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset());
    const choice = getLegalCommands(restored, ruleset(), 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const resumed = dispatch(restored, ruleset(), envelope(restored, 'p1', choice));
    expect(resumed.error).toBeUndefined(); expect(resumed.state.enemyTargets.core!.status).toBe('defeated'); expect(resumed.state.rngState).toBe(rng);
    expect(resumed.events.filter(({ type }) => type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1);
  });

  it('keeps health targets without a policy out of both legal query and authoritative ATTACK_TARGET dispatch', () => {
    const state = game(); state.phase = 'combat'; const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    state.enemyTargets[targetId]!.health = { current: 1, max: 1 }; const before = structuredClone(state);
    expect(getLegalCommands(state, ruleset(), 'p1').some((command) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toBe(false);
    const result = dispatch(state, ruleset(), envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.state).toEqual(before);
  });

  it('rejects health targets even when an encounter disposition policy exists until an attack-resolution policy is defined', () => {
    const state = game(); const card = ordinaryMonsterCard(state);
    expect(run(state, { kind: 'sequence', effects: [createEncounter, target('core', card, 'core', 1)] }).status).toBe('completed'); state.phase = 'combat'; state.players[0]!.turnCombatBonus = 99;
    const before = structuredClone(state); expect(dispatch(state, ruleset(), envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: 'core' })).error?.code).toBe('INVALID_COMMAND'); expect(state).toEqual(before);
  });

  it('rejects unknown required target and part refs without an empty encounter completion', () => {
    const entry = policy({ kind: 'required-targets-defeated', match: 'all', targetIds: ['missing'], partKeys: ['missing-part'] }); const state = game(entry); const card = ordinaryMonsterCard(state);
    expect(run(state, { kind: 'sequence', effects: [createEncounter, target('core', card, 'core')] }, entry).status).toBe('completed');
    const result = evaluateEncounterCompletion(state, ruleset(entry), { schemaVersion: 1, encounterId: 'test:e', policy: ref });
    expect(result).toMatchObject({ status: 'failed', reason: 'REQUIRED_TARGET_NOT_FOUND' });
  });

  it('resumes encounter nodes inside a lifecycle hook without replaying prior damage', () => {
    const cardState = game(); const card = ordinaryMonsterCard(cardState);
    const lifecycle: LifecycleHook = { schemaVersion: 1, moduleId: 'test:encounter', hookId: 'encounter-choice', point: 'turn-start', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'encounter-hook', body: { kind: 'sequence', effects: [createEncounter, { kind: 'create-enemy-target', targetId: 'core', encounterId: 'test:e', card: { kind: 'context-card', key: 'target' }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'part', health: { current: 2, max: 2 } }, { kind: 'damage-enemy-target', targetId: 'core', amount: 1, policy: ref }, { kind: 'choice', choiceId: 'resume', actor: { kind: 'controller' }, options: [{ id: 'ok', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } }] }, { kind: 'damage-enemy-target', targetId: 'core', amount: 1, policy: ref }] } } };
    const runtimeRules = createRuleset([testPack], [baseRulesModule, { ...rules(), lifecycleHooks: [lifecycle] }]); const state = createGame({ gameId: 'hook-encounter', seed: 1, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, runtimeRules);
    expect(dispatchLifecycle(state, runtimeRules, { schemaVersion: 1, point: 'turn-start', actorId: 'p1' }, { controllerId: 'p1', cardRefs: { target: card } }).status).toBe('suspended');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), runtimeRules); const command = getLegalCommands(restored, runtimeRules, 'p1').find((entry) => entry.type === 'RESOLVE_EFFECT_CHOICE')!; const result = dispatch(restored, runtimeRules, envelope(restored, 'p1', command));
    expect(result.error).toBeUndefined(); expect(result.state.enemyTargets.core!.status).toBe('defeated'); expect(result.events.filter((event) => event.type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1);
  });
});
