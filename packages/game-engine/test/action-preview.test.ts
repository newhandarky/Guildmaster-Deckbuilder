import { describe, expect, it } from 'vitest';
import { ActionPreviewSetSchema, type EffectDefinition, type LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateAttackResolution, evaluateCombat, executeEffect, getActionPreviewSet, getCombatPrefix, getLegalCommands, getPurchasePower, inspectEffectPreviewUncertainty, projectPlayerView, restoreSnapshot, serializeSnapshot } from '../src/index.js';
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

    expect(purchase).toMatchObject({ printedCost: 2, effectiveCost: 2, appliedModifiers: [], availablePurchasePower: available, remainingPurchasePower: available - 2 });
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

    expect(preview).toMatchObject({ kind: 'purchase', status: 'ready', availablePurchasePower: 3, printedCost: 2, effectiveCost: 2, appliedModifiers: [], remainingPurchasePower: 1 });
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

  it('is non-interfering across states that differ only by a hidden command-before draw', () => {
    const moduleId = 'test:preview-purchase-hidden-draw';
    const draw: EffectDefinition['body'] = { kind: 'draw', player: { kind: 'controller' }, count: 1 };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, draw)])]);
    const first = createGame({ gameId: 'preview-purchase-hidden-draw', seed: 36, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    first.phase = 'purchase';
    const firstPlayer = first.players[0]!;
    const purchaseCardId = firstPlayer.hand.find((cardId) => (first.cards[cardId]?.definitionId ?? '').includes('/stone')) ?? firstPlayer.hand[0]!;
    const noPurchaseCardId = firstPlayer.party[0]!.adventurerId;
    firstPlayer.hand.splice(firstPlayer.hand.indexOf(purchaseCardId), 1);
    firstPlayer.party.splice(0, 1);
    firstPlayer.drawPile = [purchaseCardId];
    first.removedCards.push(noPurchaseCardId);
    const second = structuredClone(first);
    second.players[0]!.drawPile = [noPurchaseCardId];
    second.removedCards = second.removedCards.filter((cardId) => cardId !== noPurchaseCardId);
    second.removedCards.push(purchaseCardId);

    expect(projectPlayerView(first, ruleset, 'p1')).toEqual(projectPlayerView(second, ruleset, 'p1'));
    const firstLegal = getLegalCommands(first, ruleset, 'p1');
    const secondLegal = getLegalCommands(second, ruleset, 'p1');
    const firstPreview = getActionPreviewSet(first, ruleset, 'p1');
    const secondPreview = getActionPreviewSet(second, ruleset, 'p1');
    expect(secondLegal).toEqual(firstLegal);
    expect(secondPreview).toEqual(firstPreview);
    expect(firstPreview.items.filter(({ kind }) => kind === 'purchase').every(({ status }) => status === 'requires-lifecycle')).toBe(true);
    expect(first.players[0]!.drawPile).toEqual([purchaseCardId]);
    expect(second.players[0]!.drawPile).toEqual([noPurchaseCardId]);
  });

  it('does not reveal hidden module-state activation through preview readiness', () => {
    const moduleId = 'test:preview-hidden-activation';
    const hook: LifecycleHook = { ...commandBefore(moduleId, purchaseBonus(100)), activation: { kind: 'module-state-equals', key: 'enabled', value: true } };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [hook])]);
    const active = createGame({ gameId: 'preview-hidden-activation', seed: 38, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    active.phase = 'purchase';
    active.moduleState[moduleId] = { enabled: true };
    const inactive = structuredClone(active);
    inactive.moduleState[moduleId] = { enabled: false };

    expect(projectPlayerView(active, ruleset, 'p1')).toEqual(projectPlayerView(inactive, ruleset, 'p1'));
    expect(getLegalCommands(active, ruleset, 'p1')).toEqual(getLegalCommands(inactive, ruleset, 'p1'));
    expect(getActionPreviewSet(active, ruleset, 'p1')).toEqual(getActionPreviewSet(inactive, ruleset, 'p1'));
    expect(getActionPreviewSet(active, ruleset, 'p1').items.filter(({ kind }) => kind === 'purchase').every(({ status }) => status === 'requires-lifecycle')).toBe(true);
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

  it('keeps registered health resolution authoritative but withholds encounter-dependent preview values', () => {
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

    expect(evaluation.evaluation.damage).toMatchObject({
      actualDamage: 1,
      healthAfter: { current: 1, max: 2 },
      lethal: false,
    });
    expect(preview).toEqual({
      kind: 'attack',
      status: 'requires-lifecycle',
      command: { type: 'ATTACK_TARGET', targetId: target.targetId },
      targetId: target.targetId,
    });
  });

  it('is non-interfering when an opponent hidden card controls a continuous combat modifier', () => {
    const first = createGame({ gameId: 'preview-hidden-continuous', seed: 39, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, testRuleset);
    const opponent = first.players[1]!;
    const sourceCardId = opponent.hand[0]!;
    const replacementCardId = opponent.party.shift()!.adventurerId;
    first.removedCards.push(replacementCardId);
    const moduleId = 'test:preview-hidden-continuous';
    const module: RulesModule = {
      id: moduleId,
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      continuousRules: [{ schemaVersion: 1, moduleId, effectId: 'hidden-source-combat', sourceCardId, duration: 'while-source-present', priority: 1, target: 'combat-modifier', amount: 1 }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    first.rulesModules.push({ id: moduleId, version: '1' });
    first.moduleState[moduleId] = {};
    first.enemyTargets['test:terminal-source-history'] = { targetId: 'test:terminal-source-history', cardInstanceId: sourceCardId, kind: 'history', status: 'defeated', attachments: [], moduleState: {} };
    first.phase = 'combat';
    const removedSlots = first.players[0]!.party.splice(3);
    first.removedCards.push(...removedSlots.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]));
    const second = structuredClone(first);
    second.players[1]!.hand[0] = replacementCardId;
    second.removedCards = second.removedCards.filter((cardId) => cardId !== replacementCardId);
    second.removedCards.push(sourceCardId);
    const targetId = Object.values(first.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const firstCombat = evaluateCombat(first, ruleset, 'p1', targetId);
    const secondCombat = evaluateCombat(second, ruleset, 'p1', targetId);
    if (firstCombat.status !== 'ready' || secondCombat.status !== 'ready') throw new Error('Expected ready combat evaluations.');
    expect(firstCombat.evaluation.requiredCombat).toBe(secondCombat.evaluation.requiredCombat + 1);
    expect(getCombatPrefix(first, ruleset, 'p1', firstCombat.evaluation.requiredCombat)).toBeUndefined();
    expect(getCombatPrefix(second, ruleset, 'p1', secondCombat.evaluation.requiredCombat)).toBeDefined();

    expect(projectPlayerView(first, ruleset, 'p1')).toEqual(projectPlayerView(second, ruleset, 'p1'));
    expect(getLegalCommands(first, ruleset, 'p1')).toEqual(getLegalCommands(second, ruleset, 'p1'));
    expect(getLegalCommands(first, ruleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getActionPreviewSet(first, ruleset, 'p1')).toEqual(getActionPreviewSet(second, ruleset, 'p1'));
    expect(getActionPreviewSet(first, ruleset, 'p1').items.filter(({ kind }) => kind === 'attack').every(({ status }) => status === 'requires-lifecycle')).toBe(true);
  });

  it('is non-interfering when health attack policies observe a hidden encounter kind', () => {
    const moduleId = 'test:preview-hidden-encounter';
    const module: RulesModule = {
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
      attackResolutionPolicies: [
        { schemaVersion: 1, moduleId, policyId: 'alpha-hit', priority: 1, ordering: 'explicit-priority', when: { kind: 'encounter-kind-in', kinds: ['alpha'] }, damage: { kind: 'fixed', amount: 1 }, encounterPolicy: { moduleId, policyId: 'health-target' }, reasonCode: { namespace: moduleId, code: 'ALPHA_HIT' } },
        { schemaVersion: 1, moduleId, policyId: 'beta-hit', priority: 2, ordering: 'explicit-priority', when: { kind: 'encounter-kind-in', kinds: ['beta'] }, damage: { kind: 'fixed', amount: 2 }, encounterPolicy: { moduleId, policyId: 'health-target' }, reasonCode: { namespace: moduleId, code: 'BETA_HIT' } },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const first = createGame({ gameId: 'preview-hidden-encounter', seed: 40, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    const cardId = first.zones['base:monster-deck']!.cardIds.find((id) => first.cards[id]!.definitionId === 'test:monster/wolf')!;
    const setup: EffectDefinition = { schemaVersion: 1, effectId: 'preview-hidden-encounter-setup', body: { kind: 'sequence', effects: [
      { kind: 'create-enemy-encounter', encounterId: 'test:hidden-encounter', encounterKind: 'alpha', rulesModuleId: moduleId, policy: { moduleId, policyId: 'health-target' } },
      { kind: 'create-enemy-target', targetId: 'test:hidden-health-target', encounterId: 'test:hidden-encounter', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'hidden-part', health: { current: 3, max: 3 } },
    ] } };
    const setupResult = executeEffect(first, ruleset, setup, { controllerId: 'p1' }, 'preview-hidden-encounter-setup');
    if (setupResult.status !== 'completed') throw new Error(setupResult.error);
    first.phase = 'combat';
    first.players[0]!.turnCombatBonus = 99;
    const encounter = first.enemyEncounters.find(({ encounterId }) => encounterId === 'test:hidden-encounter')!;
    const target = first.enemyTargets['test:hidden-health-target']!;
    const second = structuredClone(first);
    const secondEncounter = second.enemyEncounters.find(({ encounterId }) => encounterId === encounter.encounterId)!;
    secondEncounter.kind = 'beta';
    secondEncounter.status = 'finished';
    expect(evaluateAttackResolution(first, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: target.targetId, registry: { rulesetVersion: first.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }).status).toBe('ready');
    expect(evaluateAttackResolution(second, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: target.targetId, registry: { rulesetVersion: second.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } }).status).toBe('failed');

    expect(projectPlayerView(first, ruleset, 'p1')).toEqual(projectPlayerView(second, ruleset, 'p1'));
    expect(getLegalCommands(first, ruleset, 'p1')).toEqual(getLegalCommands(second, ruleset, 'p1'));
    expect(getLegalCommands(first, ruleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: target.targetId });
    expect(getActionPreviewSet(first, ruleset, 'p1')).toEqual(getActionPreviewSet(second, ruleset, 'p1'));
    expect(getActionPreviewSet(first, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === target.targetId)).toEqual({
      kind: 'attack',
      status: 'requires-lifecycle',
      command: { type: 'ATTACK_TARGET', targetId: target.targetId },
      targetId: target.targetId,
    });
  });

  it('withholds non-health results when a hidden encounter completion state can reject dispatch', () => {
    const moduleId = 'test:preview-hidden-non-health-encounter';
    const ref = { moduleId, policyId: 'explicit-finish' };
    const module: RulesModule = {
      id: moduleId,
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      encounterResolutionPolicies: [{
        schemaVersion: 1,
        moduleId,
        policyId: ref.policyId,
        priority: 1,
        ordering: 'explicit-priority',
        completionCondition: { kind: 'explicit-only' },
        defeatedTargetDisposition: { kind: 'removed' },
        removedTargetDisposition: { kind: 'removed' },
        attachmentDisposition: { kind: 'removed' },
        reasonCode: { namespace: moduleId, code: 'FINISHED' },
      }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const active = createGame({ gameId: 'preview-hidden-non-health-encounter', seed: 42, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    const cardId = active.zones['base:monster-deck']!.cardIds.find((id) => active.cards[id]!.definitionId === 'test:monster/wolf')!;
    const setup: EffectDefinition = { schemaVersion: 1, effectId: 'preview-hidden-non-health-setup', body: { kind: 'sequence', effects: [
      { kind: 'create-enemy-encounter', encounterId: 'test:hidden-non-health', encounterKind: 'hidden', rulesModuleId: moduleId, policy: ref },
      { kind: 'create-enemy-target', targetId: 'test:hidden-non-health-target', encounterId: 'test:hidden-non-health', card: { kind: 'card-instance', cardInstanceId: cardId }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'hidden-part' },
    ] } };
    const setupResult = executeEffect(active, ruleset, setup, { controllerId: 'p1' }, 'preview-hidden-non-health-setup');
    if (setupResult.status !== 'completed') throw new Error(setupResult.error);
    active.phase = 'combat';
    active.players[0]!.turnCombatBonus = 99;
    const finished = structuredClone(active);
    finished.enemyEncounters.find(({ encounterId }) => encounterId === 'test:hidden-non-health')!.status = 'finished';
    const targetId = 'test:hidden-non-health-target';

    expect(projectPlayerView(active, ruleset, 'p1')).toEqual(projectPlayerView(finished, ruleset, 'p1'));
    expect(getLegalCommands(active, ruleset, 'p1')).toEqual(getLegalCommands(finished, ruleset, 'p1'));
    expect(getLegalCommands(active, ruleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getActionPreviewSet(active, ruleset, 'p1')).toEqual(getActionPreviewSet(finished, ruleset, 'p1'));
    expect(getActionPreviewSet(active, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === targetId)).toEqual({
      kind: 'attack',
      status: 'requires-lifecycle',
      command: { type: 'ATTACK_TARGET', targetId },
      targetId,
    });
    expect(dispatch(active, ruleset, envelope(active, 'p1', { type: 'ATTACK_TARGET', targetId }, 'active-non-health')).error).toBeUndefined();
    expect(dispatch(finished, ruleset, envelope(finished, 'p1', { type: 'ATTACK_TARGET', targetId }, 'finished-non-health')).error?.code).toBe('INVALID_COMMAND');
  });

  it('rejects a Snapshot that marks a static no-policy encounter as finished', () => {
    const snapshot = structuredClone(serializeSnapshot(makeGame()));
    snapshot.state.enemyEncounters.find(({ encounterId }) => encounterId === 'base:enemies')!.status = 'finished';

    expect(() => restoreSnapshot(snapshot, testRuleset)).toThrow('Finished encounter base:enemies must have a resolution policy.');
  });

  it('withholds attack results when combat reward selection can observe a hidden encounter kind', () => {
    const moduleId = 'test:preview-hidden-reward-kind';
    const reward = (effectId: string): EffectDefinition => ({ schemaVersion: 1, effectId, body: combatBonus(0) });
    const module: RulesModule = {
      id: moduleId,
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      combatRewardPolicies: [
        { schemaVersion: 1, moduleId, rewardPolicyId: 'public', priority: 1, condition: { kind: 'always', value: true }, recipient: 'defeating-player', reward: reward('public-reward') },
        { schemaVersion: 1, moduleId, rewardPolicyId: 'secret', priority: 1, condition: { kind: 'encounter-kind-in', kinds: ['secret'] }, recipient: 'defeating-player', reward: reward('secret-reward') },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const publicState = createGame({ gameId: 'preview-hidden-reward-kind', seed: 43, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    publicState.phase = 'combat';
    publicState.players[0]!.turnCombatBonus = 99;
    const secretSnapshot = structuredClone(serializeSnapshot(publicState));
    secretSnapshot.state.enemyEncounters.find(({ encounterId }) => encounterId === 'base:enemies')!.kind = 'secret';
    const secretState = restoreSnapshot(secretSnapshot, ruleset);
    const targetId = Object.values(publicState.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;

    expect(projectPlayerView(publicState, ruleset, 'p1')).toEqual(projectPlayerView(secretState, ruleset, 'p1'));
    expect(getLegalCommands(publicState, ruleset, 'p1')).toEqual(getLegalCommands(secretState, ruleset, 'p1'));
    expect(getActionPreviewSet(publicState, ruleset, 'p1')).toEqual(getActionPreviewSet(secretState, ruleset, 'p1'));
    expect(getActionPreviewSet(publicState, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === targetId)).toMatchObject({ status: 'requires-lifecycle' });
    expect(dispatch(publicState, ruleset, envelope(publicState, 'p1', { type: 'ATTACK_TARGET', targetId }, 'public-reward')).error).toBeUndefined();
    const secretBefore = structuredClone(secretState);
    const failed = dispatch(secretState, ruleset, envelope(secretState, 'p1', { type: 'ATTACK_TARGET', targetId }, 'secret-reward'));
    expect(failed.error?.code).toBe('INVALID_COMMAND');
    expect(failed.state).toEqual(secretBefore);
    expect(failed.events).toEqual([]);
  });

  it('treats every encounter-dependent effect node as hidden-information uncertainty', () => {
    const state = makeGame();
    const ref = { moduleId: 'test:encounter', policyId: 'policy' };
    const nodes: EffectDefinition['body'][] = [
      { kind: 'create-enemy-encounter', encounterId: 'encounter', encounterKind: 'kind', rulesModuleId: 'test:encounter', policy: ref },
      { kind: 'create-enemy-target', targetId: 'target', encounterId: 'encounter', card: { kind: 'card-instance', cardInstanceId: 'card' }, from: { kind: 'shared-zone', zoneId: 'base:monster-deck' }, targetKind: 'part' },
      { kind: 'attach-card-to-enemy-target', targetId: 'target', card: { kind: 'card-instance', cardInstanceId: 'card' }, from: { kind: 'shared-zone', zoneId: 'base:item-row' } },
      { kind: 'damage-enemy-target', targetId: 'target', amount: 1, policy: ref },
      { kind: 'defeat-enemy-target', targetId: 'target', policy: ref },
      { kind: 'remove-enemy-target', targetId: 'target', policy: ref },
      { kind: 'finish-enemy-encounter', encounterId: 'encounter', policy: ref },
    ];

    for (const node of nodes) expect(inspectEffectPreviewUncertainty(node, state, { controllerId: 'p1' }, 'p1')).toEqual({ usesRandomness: false, observesHiddenInformation: true });
  });

  it('does not expose hidden encounter completion state through command-before discovery', () => {
    const moduleId = 'test:preview-hidden-encounter-effect';
    const ref = { moduleId, policyId: 'explicit-finish' };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, { kind: 'finish-enemy-encounter', encounterId: 'test:hidden-finish', policy: ref })], {
      encounterResolutionPolicies: [{
        schemaVersion: 1,
        moduleId,
        policyId: ref.policyId,
        priority: 1,
        ordering: 'explicit-priority',
        completionCondition: { kind: 'explicit-only' },
        defeatedTargetDisposition: { kind: 'removed' },
        removedTargetDisposition: { kind: 'removed' },
        attachmentDisposition: { kind: 'removed' },
        reasonCode: { namespace: moduleId, code: 'FINISHED' },
      }],
    })]);
    const active = createGame({ gameId: 'preview-hidden-encounter-effect', seed: 41, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'human' }], startingPlayerId: 'p1' }, ruleset);
    active.phase = 'purchase';
    active.players[0]!.turnPurchaseBonus = 10;
    active.enemyEncounters.push({ encounterId: 'test:hidden-finish', targetIds: [], kind: 'hidden', status: 'active', rulesModuleId: moduleId, resolutionPolicy: ref, state: {} });
    const finished = structuredClone(active);
    finished.enemyEncounters.find(({ encounterId }) => encounterId === 'test:hidden-finish')!.status = 'finished';

    expect(projectPlayerView(active, ruleset, 'p1')).toEqual(projectPlayerView(finished, ruleset, 'p1'));
    expect(getLegalCommands(active, ruleset, 'p1')).toEqual(getLegalCommands(finished, ruleset, 'p1'));
    expect(getActionPreviewSet(active, ruleset, 'p1')).toEqual(getActionPreviewSet(finished, ruleset, 'p1'));
    expect(getActionPreviewSet(active, ruleset, 'p1').items.filter(({ kind }) => kind === 'purchase').every(({ status }) => status === 'requires-lifecycle')).toBe(true);
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

  it('keeps every choice option discoverable when a later option contains randomness', () => {
    const moduleId = 'test:preview-choice-random';
    const choice: EffectDefinition['body'] = {
      kind: 'choice',
      choiceId: 'random-stance',
      actor: { kind: 'controller' },
      options: [
        { id: 'steady', effect: combatBonus(0) },
        { id: 'gamble', effect: { kind: 'random', randomId: 'stance-random', outcomes: [{ id: 'low', effect: combatBonus(-100) }, { id: 'high', effect: combatBonus(100) }] } },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, previewModule(moduleId, [commandBefore(moduleId, choice)])]);
    const state = createGame({ gameId: 'preview-choice-random', seed: 37, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const beforeRng = state.rngState;
    expect(getActionPreviewSet(state, ruleset, 'p1').items.find((item) => item.kind === 'attack' && item.targetId === targetId)).toMatchObject({ status: 'requires-lifecycle' });
    expect(state.rngState).toBe(beforeRng);

    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'preview-choice-random'));
    expect(suspended.state.effectState.pendingChoice?.choiceId).toBe('random-stance');
    expect(getLegalCommands(suspended.state, ruleset, 'p1').filter(({ type }) => type === 'RESOLVE_EFFECT_CHOICE')).toHaveLength(2);
    expect(suspended.state.rngState).toBe(beforeRng);
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
