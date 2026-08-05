import { describe, expect, it } from 'vitest';
import { ActionPreviewSetSchema, type EffectDefinition, type LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateAttackResolution, executeEffect, getActionPreviewSet, getLegalCommands, getPurchasePower, restoreSnapshot, serializeSnapshot } from '../src/index.js';
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

const commandBefore = (moduleId: string, body: EffectDefinition['body'], hookId = 'preview-command'): LifecycleHook => ({
  schemaVersion: 1,
  moduleId,
  hookId,
  point: 'command-before',
  kind: 'trigger',
  priority: 1,
  effect: { schemaVersion: 1, effectId: `${moduleId}:${hookId}`, body },
});

const previewModule = (moduleId: string, lifecycleHooks: readonly LifecycleHook[], extra: Partial<RulesModule> = {}): RulesModule => ({
  id: moduleId,
  version: '1',
  lifecycleHooks,
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
  ...extra,
});

const purchaseBonus = (amount: number): EffectDefinition['body'] => ({
  kind: 'modify-value',
  target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } },
  amount,
});

const combatBonus = (amount: number): EffectDefinition['body'] => ({
  kind: 'modify-value',
  target: { kind: 'turn-combat-bonus', player: { kind: 'controller' } },
  amount,
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

  it('uses deterministic command-before purchase state for legal commands, preview values, and dispatch', () => {
    const moduleId = 'test:preview-purchase-automatic';
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, purchaseBonus(3))])]);
    const state = createGame({ gameId: 'preview-purchase-automatic', seed: 29, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'purchase';
    state.players[0]!.turnPurchaseSpent = getPurchasePower(state, ruleset, 'p1');
    const before = structuredClone(state);
    const command = getLegalCommands(state, ruleset, 'p1').find((candidate): candidate is Extract<typeof candidate, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD');
    if (!command) throw new Error('Expected the automatic purchase bonus to make a card legal.');
    const preview = getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'purchase' && item.cardId === command.cardId);

    expect(preview).toMatchObject({ kind: 'purchase', status: 'ready', availablePurchasePower: 3, cost: 2, remainingPurchasePower: 1 });
    expect(state).toEqual(before);
    const result = dispatch(state, ruleset, envelope(state, 'p1', command, 'preview-purchase-automatic'));
    expect(result.error).toBeUndefined();
    expect(result.state.revision).toBe(1);
  });

  it('keeps purchase discoverable but withholds exact values while command-before choice is unresolved', () => {
    const moduleId = 'test:preview-purchase-choice';
    const choice: EffectDefinition['body'] = {
      kind: 'choice',
      choiceId: 'purchase-boost',
      actor: { kind: 'controller' },
      options: [{ id: 'none', effect: purchaseBonus(0) }, { id: 'boost', effect: purchaseBonus(3) }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, choice)])]);
    const state = createGame({ gameId: 'preview-purchase-choice', seed: 30, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'purchase';
    state.players[0]!.turnPurchaseSpent = getPurchasePower(state, ruleset, 'p1');
    const command = getLegalCommands(state, ruleset, 'p1').find((candidate): candidate is Extract<typeof candidate, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD');
    if (!command) throw new Error('Expected one completable purchase branch.');

    expect(getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'purchase' && item.cardId === command.cardId)).toEqual({
      kind: 'purchase',
      status: 'requires-lifecycle',
      command,
      cardId: command.cardId,
    });
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', command, 'preview-purchase-choice'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice?.choiceId).toBe('purchase-boost');
    expect(suspended.state.revision).toBe(0);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    expect(getActionPreviewSet(restored, ruleset, 'p1').items).toEqual([]);
    const pending = restored.effectState.pendingChoice!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'boost' }, 'preview-purchase-choice-resume'));
    expect(completed.error).toBeUndefined();
    expect(completed.state).toMatchObject({ revision: 1, effectState: {}, eventLogCursor: completed.events.length });
    expect(completed.state.players[0]!.discardPile).toContain(command.cardId);
  });

  it('withholds purchase values while command-before counter consent is unresolved', () => {
    const moduleId = 'test:preview-purchase-consent';
    const request: EffectDefinition['body'] = {
      kind: 'request-counter-consent',
      requestId: 'purchase-consent',
      policy: { moduleId, policyId: 'share-token' },
      counterOwner: { kind: 'controller' },
      outcomes: { accepted: purchaseBonus(3), declined: purchaseBonus(0), cancelled: purchaseBonus(0), expired: purchaseBonus(0) },
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, request)], {
      counterConsentPolicies: [{ schemaVersion: 1, moduleId, policyId: 'share-token', resourceId: `${moduleId}:token`, requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' } }],
    })]);
    const state = createGame({ gameId: 'preview-purchase-consent', seed: 31, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'purchase';
    state.players[0]!.turnPurchaseSpent = getPurchasePower(state, ruleset, 'p1');
    state.players[0]!.counters.push({ resourceId: `${moduleId}:token`, amount: 1, visibility: 'allPlayersByConsent' });
    const before = structuredClone(state);
    const command = getLegalCommands(state, ruleset, 'p1').find((candidate): candidate is Extract<typeof candidate, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD');
    if (!command) throw new Error('Expected consent-dependent purchase discovery.');

    expect(getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'purchase' && item.cardId === command.cardId)).toMatchObject({ kind: 'purchase', status: 'requires-lifecycle' });
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', command, 'preview-purchase-consent'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingCounterConsent?.requestId).toBe('purchase-consent');
    expect(suspended.state.revision).toBe(0);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const declined = dispatch(restored, ruleset, envelope(restored, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'purchase-consent', response: 'decline' }, 'preview-purchase-consent-decline'));
    expect(declined.error?.code).toBe('INVALID_COMMAND');
    expect(declined.state).toEqual(before);
    expect(declined.events).toEqual([]);
    expect(declined.state.eventLogCursor).toBe(0);
  });

  it('does not expose or consume a future random purchase result', () => {
    const moduleId = 'test:preview-purchase-random';
    const random: EffectDefinition['body'] = { kind: 'random', randomId: 'purchase-random', outcomes: [{ id: 'base', effect: purchaseBonus(0) }, { id: 'boost', effect: purchaseBonus(100) }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, random)])]);
    const state = createGame({ gameId: 'preview-purchase-random', seed: 35, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'purchase';
    const before = structuredClone(state);
    const command = getLegalCommands(state, ruleset, 'p1').find((candidate): candidate is Extract<typeof candidate, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD');
    if (!command) throw new Error('Expected random-dependent purchase discovery.');
    const preview = getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'purchase' && item.cardId === command.cardId);

    expect(preview).toEqual({ kind: 'purchase', status: 'requires-lifecycle', command, cardId: command.cardId });
    expect(state).toEqual(before);
    expect(state.rngState).toBe(before.rngState);
    const completed = dispatch(state, ruleset, envelope(state, 'p1', command, 'preview-purchase-random'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.rngState).not.toBe(before.rngState);
    expect(completed.state.revision).toBe(1);
  });

  it('removes purchases made impossible by deterministic command-before effects and preserves rollback', () => {
    const moduleId = 'test:preview-purchase-rollback';
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, purchaseBonus(-100))])]);
    const state = createGame({ gameId: 'preview-purchase-rollback', seed: 32, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'purchase';
    const cardId = state.zones['base:adventurer-row']!.cardIds[0]!;
    const before = structuredClone(state);

    expect(getLegalCommands(state, ruleset, 'p1').some(({ type }) => type === 'BUY_CARD')).toBe(false);
    expect(getActionPreviewSet(state, ruleset, 'p1').items.some(({ kind }) => kind === 'purchase')).toBe(false);
    const failed = dispatch(state, ruleset, envelope(state, 'p1', { type: 'BUY_CARD', cardId }, 'preview-purchase-rollback'));
    expect(failed.error?.code).toBe('INVALID_COMMAND');
    expect(failed.state).toEqual(before);
    expect(failed.events).toEqual([]);
    expect(failed.state.rngState).toBe(before.rngState);
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

  it('withholds combat values while command-before counter consent is unresolved', () => {
    const moduleId = 'test:preview-attack-consent';
    const request: EffectDefinition['body'] = {
      kind: 'request-counter-consent',
      requestId: 'attack-consent',
      policy: { moduleId, policyId: 'share-token' },
      counterOwner: { kind: 'controller' },
      outcomes: { accepted: combatBonus(1), declined: combatBonus(0), cancelled: combatBonus(0), expired: combatBonus(0) },
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, request)], {
      counterConsentPolicies: [{ schemaVersion: 1, moduleId, policyId: 'share-token', resourceId: `${moduleId}:token`, requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' } }],
    })]);
    const state = createGame({ gameId: 'preview-attack-consent', seed: 33, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'combat';
    state.players[0]!.counters.push({ resourceId: `${moduleId}:token`, amount: 1, visibility: 'allPlayersByConsent' });
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;

    expect(getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === targetId)).toEqual({
      kind: 'attack',
      status: 'requires-lifecycle',
      command: { type: 'ATTACK_TARGET', targetId },
      targetId,
    });
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'preview-attack-consent'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingCounterConsent?.requestId).toBe('attack-consent');
    expect(suspended.state.revision).toBe(0);
  });

  it.each([
    ['random', (moduleId: string): EffectDefinition['body'] => ({ kind: 'random', randomId: `${moduleId}:preview-random`, outcomes: [{ id: 'low', effect: combatBonus(0) }, { id: 'high', effect: combatBonus(100) }] }), {}],
    ['roll-die', (moduleId: string): EffectDefinition['body'] => ({ kind: 'roll-die', moduleId, diceId: 'preview-d2', outcomes: [{ face: 1, effect: combatBonus(0) }, { face: 2, effect: combatBonus(100) }] }), { diceDefinitions: [{ schemaVersion: 1 as const, moduleId: '', diceId: 'preview-d2', sides: 2 }] }],
  ] as const)('does not expose or consume future %s command-before results', (_kind, body, extra) => {
    const moduleId = `test:preview-attack-${_kind}`;
    const moduleExtra: Partial<RulesModule> = 'diceDefinitions' in extra
      ? { diceDefinitions: extra.diceDefinitions.map((definition) => ({ ...definition, moduleId })) }
      : {};
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, body(moduleId))], moduleExtra)]);
    const state = createGame({ gameId: `preview-attack-${_kind}`, seed: 34, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const before = structuredClone(state);
    const first = getActionPreviewSet(state, ruleset, 'p1');
    const second = getActionPreviewSet(state, ruleset, 'p1');

    expect(getLegalCommands(state, ruleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(first.items.find((item) => item.kind === 'attack' && item.targetId === targetId)).toEqual({ kind: 'attack', status: 'requires-lifecycle', command: { type: 'ATTACK_TARGET', targetId }, targetId });
    expect(second).toEqual(first);
    expect(state).toEqual(before);
    expect(state.rngState).toBe(before.rngState);

    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, `preview-${_kind}`));
    expect(result.error).toBeUndefined();
    expect(result.state.rngState).not.toBe(before.rngState);
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
    expect(ActionPreviewSetSchema.safeParse({ ...preview, items: [{ ...attack, partySlotCount: 0 }] }).success).toBe(false);
    expect(ActionPreviewSetSchema.safeParse({ ...preview, items: [{ ...attack, partySlotCount: 1, participantCardIds: [] }] }).success).toBe(false);
  });
});
