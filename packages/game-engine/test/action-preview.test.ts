import { describe, expect, it } from 'vitest';
import { ActionPreviewSetSchema, type EffectDefinition, type LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateAttackResolution, executeEffect, getActionPreviewSet, getPurchasePower, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

const commandBeforeChoice = (moduleId: string): LifecycleHook => ({
  schemaVersion: 1,
  moduleId,
  hookId: 'prepare-attack',
  point: 'command-before',
  kind: 'trigger',
  priority: 1,
  effect: {
    schemaVersion: 1,
    effectId: `${moduleId}:prepare-attack`,
    body: {
      kind: 'choice',
      choiceId: 'combat-stance',
      actor: { kind: 'controller' },
      options: [
        { id: 'steady', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 0 } },
        { id: 'push', effect: { kind: 'modify-value', target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } }, amount: 1 } },
      ],
    },
  },
});

describe('authoritative action previews', () => {
  it('returns deterministic JSON-only attack previews without mutating state or RNG', () => {
    const state = makeGame();
    state.phase = 'combat';
    const before = structuredClone(state);
    const first = getActionPreviewSet(state, testRuleset, 'p1');
    const second = getActionPreviewSet(state, testRuleset, 'p1');
    const monster = first.items.find((item) => item.kind === 'attack' && item.status === 'ready' && state.enemyTargets[item.targetId]?.kind === 'monster');

    expect(monster).toMatchObject({
      kind: 'attack',
      status: 'ready',
      requiredCombat: 3,
      committedCombat: 3,
      surplusCombat: 0,
      partySlotCount: 3,
      outcome: { kind: 'defeat-target' },
    });
    if (!monster || monster.kind !== 'attack' || monster.status !== 'ready') throw new Error('Missing ready monster preview.');
    expect(monster.participantCardIds).toHaveLength(3);
    expect(ActionPreviewSetSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(second).toEqual(first);
    expect(state).toEqual(before);
    expect(state.rngState).toBe(before.rngState);
  });

  it('projects exact purchase cost and remaining power for current legal commands', () => {
    const state = makeGame();
    state.phase = 'purchase';
    state.players[0]!.turnPurchaseBonus = 10;
    const available = getPurchasePower(state, testRuleset, 'p1');
    const previews = getActionPreviewSet(state, testRuleset, 'p1');
    const purchase = previews.items.find((item) => item.kind === 'purchase');
    if (!purchase || purchase.kind !== 'purchase') throw new Error('Missing purchase preview.');

    expect(purchase).toMatchObject({ cost: 2, availablePurchasePower: available, remainingPurchasePower: available - 2 });
    const result = dispatch(state, testRuleset, envelope(state, 'p1', purchase.command, 'preview-purchase'));
    expect(result.error).toBeUndefined();
    const after = getActionPreviewSet(result.state, testRuleset, 'p1');
    expect(after.revision).toBe(1);
    expect(after.items).not.toContainEqual(expect.objectContaining({ kind: 'purchase', cardId: purchase.cardId }));
  });

  it('projects registered fixed damage and remaining health for health targets', () => {
    const moduleId = 'test:preview-health';
    const healthModule: RulesModule = {
      id: moduleId,
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      encounterResolutionPolicies: [{
        schemaVersion: 1,
        moduleId,
        policyId: 'health-target',
        priority: 1,
        ordering: 'explicit-priority',
        completionCondition: { kind: 'all-targets-terminal' },
        defeatedTargetDisposition: { kind: 'removed' },
        removedTargetDisposition: { kind: 'removed' },
        attachmentDisposition: { kind: 'removed' },
        reasonCode: { namespace: moduleId, code: 'HEALTH_TARGET_RESOLVED' },
      }],
      attackResolutionPolicies: [{
        schemaVersion: 1,
        moduleId,
        policyId: 'fixed-hit',
        priority: 1,
        ordering: 'explicit-priority',
        when: { kind: 'target-kind-in', kinds: ['preview-part'] },
        damage: { kind: 'fixed', amount: 1 },
        encounterPolicy: { moduleId, policyId: 'health-target' },
        reasonCode: { namespace: moduleId, code: 'FIXED_HIT' },
      }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, healthModule]);
    const state = createGame({ gameId: 'preview-health', seed: 28, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    const cardId = state.zones['base:monster-deck']!.cardIds.find((id) => state.cards[id]!.definitionId === 'test:monster/wolf')!;
    const setup: EffectDefinition = { schemaVersion: 1, effectId: 'preview-health-target', body: { kind: 'sequence', effects: [
      { kind: 'create-enemy-encounter', encounterId: 'test:preview-health', encounterKind: 'preview-health', rulesModuleId: moduleId, policy: { moduleId, policyId: 'health-target' } },
      { kind: 'create-enemy-target', targetId: 'test:preview-core', encounterId: 'test:preview-health', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'preview-part', partKey: 'core', health: { current: 2, max: 2 } },
    ] } };
    const setupResult = executeEffect(state, ruleset, setup, { controllerId: 'p1' }, 'preview-health-setup');
    if (setupResult.status !== 'completed') throw new Error(setupResult.error);
    state.phase = 'combat';
    state.players[0]!.turnCombatBonus = 99;
    const target = state.enemyTargets['test:preview-core']!;
    const evaluation = evaluateAttackResolution(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: target.targetId, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } });
    if (evaluation.status !== 'ready') throw new Error(`${evaluation.reason}: ${evaluation.error}`);
    const preview = getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === target.targetId);

    expect(preview).toMatchObject({
      kind: 'attack',
      status: 'ready',
      requiredCombat: 3,
      committedCombat: 99,
      partySlotCount: 0,
      outcome: { kind: 'damage-target', requestedDamage: 1, actualDamage: 1, healthBefore: 2, healthAfter: 1, lethal: false, lethalOutcome: 'defeated' },
    });
  });

  it('does not invent one combat result while command-before lifecycle branches differ', () => {
    const moduleId = 'test:preview-choice';
    const choiceModule: RulesModule = {
      id: moduleId,
      version: '1',
      lifecycleHooks: [commandBeforeChoice(moduleId)],
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, choiceModule]);
    const state = createGame({ gameId: 'preview-choice', seed: 27, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const preview = getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === targetId);

    expect(preview).toEqual({ kind: 'attack', status: 'requires-lifecycle', command: { type: 'ATTACK_TARGET', targetId }, targetId });
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'preview-choice'));
    expect(suspended.state.effectState.pendingChoice?.choiceId).toBe('combat-stance');
    expect(getActionPreviewSet(suspended.state, ruleset, 'p1').items).toEqual([]);
  });

  it('is stable across Snapshot restore and rejects inconsistent or duplicate payloads', () => {
    const state = makeGame();
    state.phase = 'combat';
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), testRuleset);
    const preview = getActionPreviewSet(state, testRuleset, 'p1');
    expect(getActionPreviewSet(restored, testRuleset, 'p1')).toEqual(preview);

    const attack = preview.items.find((item) => item.kind === 'attack' && item.status === 'ready');
    if (!attack || attack.kind !== 'attack' || attack.status !== 'ready') throw new Error('Missing attack preview.');
    expect(ActionPreviewSetSchema.safeParse({ ...preview, items: [{ ...attack, surplusCombat: attack.surplusCombat + 1 }] }).success).toBe(false);
    expect(ActionPreviewSetSchema.safeParse({ ...preview, items: [attack, structuredClone(attack)] }).success).toBe(false);
    expect(ActionPreviewSetSchema.safeParse({ ...preview, items: [{ ...attack, targetId: 'tampered' }] }).success).toBe(false);
  });
});
