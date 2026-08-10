import { describe, expect, it } from 'vitest';
import type { AttackResolutionPolicy, CombatRewardPolicy, EffectDefinition, EncounterResolutionPolicy, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateAttackResolution, executeEffect, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const encounterPolicy: EncounterResolutionPolicy = {
  schemaVersion: 1,
  moduleId: 'test:health-encounter',
  policyId: 'all-parts',
  priority: 1,
  ordering: 'explicit-priority',
  completionCondition: { kind: 'all-targets-terminal' },
  defeatedTargetDisposition: { kind: 'removed' },
  removedTargetDisposition: { kind: 'removed' },
  attachmentDisposition: { kind: 'removed' },
  reasonCode: { namespace: 'test:health-encounter', code: 'PART_RESOLVED' }
};
const attackPolicy = (overrides: Partial<AttackResolutionPolicy> = {}): AttackResolutionPolicy => ({
  schemaVersion: 1,
  moduleId: 'test:health-encounter',
  policyId: 'fixed-hit',
  priority: 1,
  ordering: 'explicit-priority',
  when: { kind: 'encounter-kind-in', kinds: ['test:health'] },
  damage: { kind: 'fixed', amount: 1 },
  encounterPolicy: { moduleId: 'test:health-encounter', policyId: 'all-parts' },
  reasonCode: { namespace: 'test:health-encounter', code: 'FIXED_HIT' },
  ...overrides
});
const module = (overrides: Partial<RulesModule> = {}): RulesModule => ({
  id: 'test:health-encounter', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
  encounterResolutionPolicies: [encounterPolicy], attackResolutionPolicies: [attackPolicy()], ...overrides
});
const rules = (overrides: Partial<RulesModule> = {}, extras: readonly RulesModule[] = []): Ruleset => createRuleset([testPack], [baseRulesModule, module(overrides), ...extras]);
const game = (ruleset: Ruleset) => createGame({ gameId: 'health-attack', seed: 31, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
const setupTarget = (state: ReturnType<typeof game>, ruleset: Ruleset, health = 2): string => {
  const cardId = state.zones['base:monster-deck']!.cardIds.find((id) => state.cards[id]!.definitionId === 'test:monster/wolf')!;
  const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:create-health-target', body: { kind: 'sequence', effects: [
    { kind: 'create-enemy-encounter', encounterId: 'test:health-e', encounterKind: 'test:health', rulesModuleId: 'test:health-encounter', policy: { moduleId: 'test:health-encounter', policyId: 'all-parts' } },
    { kind: 'create-enemy-target', targetId: 'test:core', encounterId: 'test:health-e', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'part', partKey: 'core', health: { current: health, max: health } }
  ] } };
  const result = executeEffect(state, ruleset, effect, { controllerId: 'p1' }, 'test:setup');
  if (result.status !== 'completed') throw new Error(result.error);
  state.phase = 'combat'; state.players[0]!.turnCombatBonus = 99;
  return 'test:core';
};
const setupBossTarget = (state: ReturnType<typeof game>, ruleset: Ruleset): string => {
  const baseEncounter = state.enemyEncounters.find(({ encounterId }) => encounterId === 'base:enemies')!;
  const existingTarget = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
  baseEncounter.targetIds = baseEncounter.targetIds.filter((targetId) => targetId !== existingTarget.targetId);
  delete state.enemyTargets[existingTarget.targetId];
  state.zones['base:boss-row']!.cardIds = state.zones['base:boss-row']!.cardIds.filter((cardId) => cardId !== existingTarget.cardInstanceId);
  state.removedCards.push(existingTarget.cardInstanceId);
  const cardId = state.zones['base:boss-deck']!.cardIds.at(-1)!;
  const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:create-health-boss', body: { kind: 'sequence', effects: [
    { kind: 'create-enemy-encounter', encounterId: 'test:health-boss-e', encounterKind: 'test:health', rulesModuleId: 'test:health-encounter', policy: { moduleId: 'test:health-encounter', policyId: 'all-parts' } },
    { kind: 'create-enemy-target', targetId: 'test:health-boss', encounterId: 'test:health-boss-e', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'shared-zone', zoneId: 'base:boss-deck' }, targetKind: 'boss', health: { current: 1, max: 1 } }
  ] } };
  const result = executeEffect(state, ruleset, effect, { controllerId: 'p1' }, 'test:setup-health-boss');
  if (result.status !== 'completed') throw new Error(result.error);
  state.phase = 'combat'; state.players[0]!.turnCombatBonus = 99;
  return 'test:health-boss';
};
const request = (state: ReturnType<typeof game>, ruleset: Ruleset, targetId: string) => ({ schemaVersion: 1 as const, playerId: 'p1', targetId, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } });
const choiceReward = (): CombatRewardPolicy => ({ schemaVersion: 1, moduleId: 'test:health-encounter', rewardPolicyId: 'health-reward', priority: 1, condition: { kind: 'encounter-kind-in', kinds: ['test:health'] }, recipient: 'defeating-player', reward: { schemaVersion: 1, effectId: 'health-reward-choice', body: { kind: 'choice', choiceId: 'health-reward', actor: { kind: 'controller' }, options: [{ id: 'take', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 } }] } } });

describe('generic health-target attack resolution', () => {
  it('registers owned JSON-only policies and validates encounter policy references', () => {
    expect(() => rules({ attackResolutionPolicies: [attackPolicy({ moduleId: 'wrong' })] })).toThrow('must belong');
    expect(() => rules({ attackResolutionPolicies: [attackPolicy(), attackPolicy()] })).toThrow('Duplicate attack resolution policy');
    expect(() => rules({ attackResolutionPolicies: [attackPolicy({ encounterPolicy: { moduleId: 'test:health-encounter', policyId: 'missing' } })] })).toThrow('references unknown encounter policy');
    expect(() => rules({ attackResolutionPolicies: [attackPolicy({ reasonCode: { namespace: 'wrong', code: 'BAD' } })] })).toThrow('reason namespace');
    const cyclic = attackPolicy() as AttackResolutionPolicy & { loop?: unknown }; cyclic.loop = cyclic;
    expect(() => rules({ attackResolutionPolicies: [cyclic] })).toThrow('acyclic');
  });

  it('evaluates deterministically without mutating state or RNG and rejects ambiguous policy order', () => {
    const active = rules(); const state = game(active); const targetId = setupTarget(state, active, 2); const before = structuredClone(state);
    const result = evaluateAttackResolution(state, active, request(state, active, targetId));
    expect(result).toMatchObject({ status: 'ready', evaluation: { policy: { policyId: 'fixed-hit' }, combat: { requiredCombat: 3 }, partyPrefix: { slotCount: 0, power: 99, participantCardIds: [] }, damage: { actualDamage: 1, lethal: false, healthAfter: { current: 1, max: 2 } } } });
    expect(state).toEqual(before); expect(state.rngState).toBe(before.rngState);
    expect(evaluateAttackResolution(state, active, { ...request(state, active, targetId), playerId: '' })).toMatchObject({ status: 'failed', reason: 'INVALID_REQUEST' });
    expect(evaluateAttackResolution(state, active, { ...request(state, active, targetId), registry: { ...request(state, active, targetId).registry, rulesetVersion: 'tampered' } })).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });

    const competing: RulesModule = { id: 'test:competing', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', attackResolutionPolicies: [attackPolicy({ moduleId: 'test:competing', policyId: 'same-priority', reasonCode: { namespace: 'test:competing', code: 'AMBIGUOUS' } })] };
    const ambiguous = rules({}, [competing]); const ambiguousState = game(ambiguous); const ambiguousTarget = setupTarget(ambiguousState, ambiguous);
    expect(evaluateAttackResolution(ambiguousState, ambiguous, request(ambiguousState, ambiguous, ambiguousTarget))).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(getLegalCommands(ambiguousState, ambiguous, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: ambiguousTarget });
  });

  it('shares one evaluation across legal query and dispatch for partial and lethal attacks', () => {
    const active = rules(); const state = game(active); const targetId = setupTarget(state, active, 2); const rng = state.rngState;
    expect(getLegalCommands(state, active, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    const partial = dispatch(state, active, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'partial-hit'));
    expect(partial.error).toBeUndefined(); expect(partial.state.revision).toBe(1); expect(partial.state.eventLogCursor).toBe(partial.events.length); expect(partial.state.enemyTargets[targetId]!.health).toEqual({ current: 1, max: 2 }); expect(partial.state.enemyTargets[targetId]!.status).toBe('available');
    expect(partial.events.find(({ type }) => type === 'ATTACK_RESOLUTION_EVALUATED')?.payload).toMatchObject({ kind: 'attack-resolution', evaluation: { input: { targetId }, damage: { actualDamage: 1, lethal: false } } });
    expect(partial.events.filter(({ type }) => type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1); expect(partial.state.rngState).toBe(rng);

    const lethal = dispatch(partial.state, active, envelope(partial.state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'lethal-hit'));
    expect(lethal.error).toBeUndefined(); expect(lethal.state.revision).toBe(2); expect(lethal.state.eventLogCursor).toBe(partial.events.length + lethal.events.length); expect(lethal.state.enemyTargets[targetId]!.status).toBe('defeated'); expect(lethal.state.enemyTargets[targetId]!.health?.current).toBe(0);
    expect(lethal.state.enemyEncounters.find(({ encounterId }) => encounterId === 'test:health-e')!.status).toBe('finished'); expect(lethal.state.players[0]!.history.defeatedMonsters).toBe(1); expect(lethal.state.rngState).toBe(rng);
  });

  it('round-trips a lethal reward choice without replaying damage and commits one revision', () => {
    const active = rules({ combatRewardPolicies: [choiceReward()] }); const state = game(active); const targetId = setupTarget(state, active, 1); const rng = state.rngState;
    const suspended = dispatch(state, active, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'reward-choice'));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.enemyTargets[targetId]!.status).toBe('defeated'); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-reward');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), active);
    const command = getLegalCommands(restored, active, 'p1').find(({ type }) => type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, active, envelope(restored, 'p1', command, 'reward-choice-resume'));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.eventLogCursor).toBe(completed.events.length); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(2); expect(completed.state.players[0]!.history.defeatedMonsters).toBe(1); expect(completed.state.rngState).toBe(rng);
    expect(completed.events.filter(({ type }) => type === 'ATTACK_RESOLUTION_EVALUATED')).toHaveLength(1); expect(completed.events.filter(({ type }) => type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1);

    const tampered = structuredClone(serializeSnapshot(suspended.state));
    const payload = (tampered.state.effectState.pendingCommand as Extract<NonNullable<typeof tampered.state.effectState.pendingCommand>, { kind: 'combat-reward' }>).events.find(({ type }) => type === 'ATTACK_RESOLUTION_EVALUATED')!.payload;
    if (!payload || payload.kind !== 'attack-resolution') throw new Error('Missing attack payload.'); payload.evaluation.damage.input.requestedDamage = 2;
    expect(() => restoreSnapshot(tampered, active)).toThrow('attack resolution is invalid or tampered');
  });

  it('round-trips lethal reward consent without replaying the attack transaction', () => {
    const consentReward: CombatRewardPolicy = { schemaVersion: 1, moduleId: 'test:health-encounter', rewardPolicyId: 'health-consent', priority: 1, condition: { kind: 'encounter-kind-in', kinds: ['test:health'] }, recipient: 'defeating-player', reward: { schemaVersion: 1, effectId: 'health-consent', body: { kind: 'request-counter-consent', requestId: 'show-health-counter', policy: { moduleId: 'test:health-encounter', policyId: 'show-counter' }, counterOwner: { kind: 'controller' }, outcomes: { accepted: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 }, declined: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 }, cancelled: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 }, expired: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 } } } } };
    const active = rules({ combatRewardPolicies: [consentReward], counterConsentPolicies: [{ schemaVersion: 1, moduleId: 'test:health-encounter', policyId: 'show-counter', resourceId: 'test:health-counter', requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' } }] });
    const state = game(active); state.players[0]!.counters.push({ resourceId: 'test:health-counter', amount: 3, visibility: 'allPlayersByConsent' }); const targetId = setupTarget(state, active, 1); const rng = state.rngState;
    const suspended = dispatch(state, active, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'reward-consent'));
    expect(suspended.state.effectState.pendingCounterConsent?.requestId).toBe('show-health-counter'); expect(suspended.state.enemyTargets[targetId]!.status).toBe('defeated'); expect(suspended.state.revision).toBe(0);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), active); const accept = getLegalCommands(restored, active, 'p2').find((command) => command.type === 'RESPOND_COUNTER_CONSENT' && command.response === 'accept')!;
    const completed = dispatch(restored, active, envelope(restored, 'p2', accept, 'reward-consent-accept'));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(1); expect(completed.state.eventLogCursor).toBe(completed.events.length); expect(completed.state.rngState).toBe(rng); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(1); expect(completed.state.players[0]!.history.defeatedMonsters).toBe(1);
    expect(completed.events.filter(({ type }) => type === 'ATTACK_RESOLUTION_EVALUATED')).toHaveLength(1); expect(completed.events.filter(({ type }) => type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1);
  });

  it('resumes post-command lifecycle after damage and rolls late failures back to the command checkpoint', () => {
    const choiceHook: LifecycleHook = { schemaVersion: 1, moduleId: 'test:health-encounter', hookId: 'audit-health-hit', point: 'event-after', eventType: 'ATTACK_RESOLUTION_EVALUATED', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'audit-health-hit', body: { kind: 'choice', choiceId: 'audit', actor: { kind: 'controller' }, options: [{ id: 'ok', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 } }] } } };
    const active = rules({ lifecycleHooks: [choiceHook] }); const state = game(active); const targetId = setupTarget(state, active, 2); const rng = state.rngState;
    const suspended = dispatch(state, active, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'post-hit'));
    expect(suspended.state.effectState.pendingPostCommand).toBeDefined(); expect(suspended.state.enemyTargets[targetId]!.health?.current).toBe(1); expect(suspended.state.revision).toBe(0);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), active); const command = getLegalCommands(restored, active, 'p1')[0]!; const completed = dispatch(restored, active, envelope(restored, 'p1', command, 'post-hit-resume'));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.health?.current).toBe(1); expect(completed.state.revision).toBe(1); expect(completed.state.eventLogCursor).toBe(completed.events.length); expect(completed.state.rngState).toBe(rng); expect(completed.events.filter(({ type }) => type === 'ENEMY_TARGET_DAMAGED')).toHaveLength(1);

    const failingHook: LifecycleHook = { ...choiceHook, hookId: 'fail-after-hit', effect: { schemaVersion: 1, effectId: 'fail-after-hit', body: { kind: 'sequence', effects: [{ kind: 'random', randomId: 'consume', outcomes: [{ id: 'only', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 1 } }] }, { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'removed' } }] } } };
    const failingRules = rules({ lifecycleHooks: [failingHook] }); const failing = game(failingRules); const failingTarget = setupTarget(failing, failingRules, 2); const before = structuredClone(failing);
    const failed = dispatch(failing, failingRules, envelope(failing, 'p1', { type: 'ATTACK_TARGET', targetId: failingTarget }, 'late-failure'));
    expect(failed.error?.code).toBe('INVALID_COMMAND'); expect(failed.state).toEqual(before); expect(failed.events).toEqual([]); expect(failed.state.rngState).toBe(before.rngState);
  });

  it('uses the committed combat replacement as the lethal encounter outcome without granting defeat rewards', () => {
    const replacement = { schemaVersion: 1 as const, moduleId: 'test:health-encounter', ruleId: 'banish-core', kind: 'replacement' as const, priority: 1, when: { kind: 'target-kind-in' as const, kinds: ['part'] }, outcome: { kind: 'remove-target' as const } };
    const active = rules({ combatRules: [replacement] }); const state = game(active); const targetId = setupTarget(state, active, 1);
    const result = dispatch(state, active, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'remove-health'));
    expect(result.error).toBeUndefined(); expect(result.state.enemyTargets[targetId]!.status).toBe('removed'); expect(result.state.players[0]!.history.defeatedMonsters).toBe(0); expect(result.events.some(({ type }) => type === 'ENEMY_TARGET_REMOVED')).toBe(true); expect(result.events.some(({ type }) => type === 'ENEMY_DEFEATED')).toBe(false);
  });

  it('refills the Boss row after health-based Boss defeat or removal', () => {
    const defeatedRules = rules(); const defeatedState = game(defeatedRules); const defeatedTargetId = setupBossTarget(defeatedState, defeatedRules);
    const defeatedDeckBefore = defeatedState.zones['base:boss-deck']!.cardIds.length;
    const defeated = dispatch(defeatedState, defeatedRules, envelope(defeatedState, 'p1', { type: 'ATTACK_TARGET', targetId: defeatedTargetId }, 'defeat-health-boss'));
    expect(defeated.error).toBeUndefined(); expect(defeated.state.enemyTargets[defeatedTargetId]!.status).toBe('defeated'); expect(defeated.state.zones['base:boss-row']!.cardIds).toHaveLength(1); expect(defeated.state.zones['base:boss-deck']!.cardIds).toHaveLength(defeatedDeckBefore - 1); expect(Object.values(defeated.state.enemyTargets).some(({ kind, status, zoneId }) => kind === 'boss' && status === 'available' && zoneId === 'base:boss-row')).toBe(true); expect(defeated.events.some(({ type }) => type === 'ENEMY_DEFEATED')).toBe(true);

    const replacement = { schemaVersion: 1 as const, moduleId: 'test:health-encounter', ruleId: 'banish-boss', kind: 'replacement' as const, priority: 1, when: { kind: 'target-kind-in' as const, kinds: ['boss'] }, outcome: { kind: 'remove-target' as const } };
    const removedRules = rules({ combatRules: [replacement] }); const removedState = game(removedRules); const removedTargetId = setupBossTarget(removedState, removedRules);
    const removed = dispatch(removedState, removedRules, envelope(removedState, 'p1', { type: 'ATTACK_TARGET', targetId: removedTargetId }, 'remove-health-boss'));
    expect(removed.error).toBeUndefined(); expect(removed.state.enemyTargets[removedTargetId]!.status).toBe('removed'); expect(removed.state.zones['base:boss-row']!.cardIds).toHaveLength(1); expect(removed.state.players[0]!.history.defeatedBosses).toBe(0); expect(removed.events.some(({ type }) => type === 'ENEMY_DEFEATED')).toBe(false);
  });
});
