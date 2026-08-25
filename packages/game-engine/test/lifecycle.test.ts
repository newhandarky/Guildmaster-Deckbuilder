import { describe, expect, it } from 'vitest';
import type { ContentPack, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, dispatchLifecycle, envelope, getLegalCommands, restoreSnapshot, resumeLifecycleChoice, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const modify = (amount: number): EffectDefinition['body'] => ({ kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount });
const hook = (moduleId: string, hookId: string, point: LifecycleHook['point'], priority: number, body: EffectDefinition['body'], kind: LifecycleHook['kind'] = 'trigger'): LifecycleHook => ({ schemaVersion: 1, moduleId, hookId, point, kind, priority, effect: { schemaVersion: 1, effectId: `${moduleId}:${hookId}`, body } });
const module = (id: string, hooks: readonly LifecycleHook[], version = '1'): RulesModule => ({ id, version, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: hooks });
const gameFor = (ruleset: Ruleset) => createGame({ gameId: 'lifecycle-game', seed: 19, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
const choiceBody = (amount = 2): EffectDefinition['body'] => ({ kind: 'choice', choiceId: 'choose-bonus', actor: { kind: 'controller' }, options: [{ id: 'accept', effect: modify(amount) }, { id: 'decline', effect: modify(0) }] });
const equipmentTriggerPack = (body: EffectDefinition['body'] = {
  kind: 'conditional',
  condition: { kind: 'has-card-at', card: { kind: 'context-card', key: 'sourceEquipment' }, location: { kind: 'context-location', key: 'sourceEquipment' } },
  whenTrue: { kind: 'draw', player: { kind: 'controller' }, count: 1 },
}): ContentPack => ({
  ...testPack,
  manifest: { ...testPack.manifest, version: 'equipment-trigger', hash: 'equipment-trigger' },
  definitions: testPack.definitions.map((definition) => definition.id === 'test:item/spear' ? {
    ...definition,
    equipmentEventTriggers: [{
      schemaVersion: 1,
      triggerId: 'draw-after-defeat',
      point: 'event-after',
      eventType: 'ENEMY_DEFEATED',
      priority: 10,
      effect: { schemaVersion: 1, effectId: 'test:item/spear/draw-after-defeat', body },
    }],
  } : definition),
});

describe('Rules Module lifecycle dispatcher', () => {
  it('rejects a zone-card-count activation that references an unknown zone', () => {
    const invalid = { ...hook('test:invalid-zone-count', 'invalid-zone-count', 'turn-start', 1, modify(1)), activation: { kind: 'zone-card-count-at-least' as const, zoneId: 'test:missing-zone', amount: 1 } };
    expect(() => createRuleset([testPack], [baseRulesModule, module('test:invalid-zone-count', [invalid])])).toThrow('references unknown activation zone test:missing-zone');
  });

  it('dispatches hooks from multiple modules in explicit priority order', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:one', [hook('test:one', 'later', 'turn-start', 2, modify(2))]), module('test:two', [hook('test:two', 'first', 'turn-start', 1, modify(1))])]); const state = gameFor(ruleset);
    const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' });
    expect(result).toMatchObject({ status: 'completed', hookIds: ['first', 'later'] }); expect(state.players[0]!.turnPurchaseBonus).toBe(3);
  });

  it('returns ORDER_POLICY_REQUIRED for equal priorities without mutating state', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:one', [hook('test:one', 'a', 'turn-start', 1, modify(1))]), module('test:two', [hook('test:two', 'b', 'turn-start', 1, modify(1))])]); const state = gameFor(ruleset); const before = structuredClone(state);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' })).toMatchObject({ status: 'unsupported', hookIds: [], reason: 'ORDER_POLICY_REQUIRED' }); expect(state).toEqual(before);
  });

  it('separates replacement event-before from trigger event-after', () => {
    const replacement = hook('test:replace', 'replace', 'event-before', 1, modify(1), 'replacement'); const trigger = hook('test:trigger', 'trigger', 'event-after', 1, modify(2)); const ruleset = createRuleset([testPack], [baseRulesModule, module('test:replace', [replacement]), module('test:trigger', [trigger])]); const state = gameFor(ruleset);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'event-before', eventType: 'TEST' }, { controllerId: 'p1' }).hookIds).toEqual(['replace']); expect(state.players[0]!.turnPurchaseBonus).toBe(1);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'event-after', eventType: 'TEST' }, { controllerId: 'p1' }).hookIds).toEqual(['trigger']); expect(state.players[0]!.turnPurchaseBonus).toBe(3);
  });

  it('round-trips a pending lifecycle choice and continues the remaining hooks through RESOLVE_EFFECT_CHOICE', () => {
    const first = hook('test:choice', 'choice', 'turn-start', 1, { kind: 'sequence', effects: [modify(1), choiceBody()] });
    const last = hook('test:last', 'last', 'turn-start', 2, modify(4));
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:choice', [first]), module('test:last', [last])]); const state = gameFor(ruleset);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start', actorId: 'p1', metadata: { source: 'test' } }, { controllerId: 'p1', playerRefs: { actor: 'p1' } }).status).toBe('suspended');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(restored.effectState.pendingLifecycle).toMatchObject({ payload: { point: 'turn-start', metadata: { source: 'test' } }, context: { playerRefs: { actor: 'p1' } }, currentHook: { moduleId: 'test:choice', hookId: 'choice' }, remainingHooks: [{ moduleId: 'test:last', hookId: 'last' }] });
    const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.optionId === 'accept')!;
    const result = dispatch(restored, ruleset, envelope(restored, 'p1', command));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.turnPurchaseBonus).toBe(7); expect(result.state.effectState).toEqual({});
  });

  it('requires a ruleset and fails closed for tampered dynamic lifecycle choices', () => {
    const dynamic = hook('test:dynamic-choice', 'choose-card', 'turn-start', 1, {
      kind: 'choose-card',
      choiceId: 'dynamic-lifecycle-card',
      actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
      predicate: { kind: 'definition-type-in', values: ['starter'] },
      selectedCardKey: 'selected',
      effect: modify(1),
    });
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:dynamic-choice', [dynamic])]);
    const state = gameFor(ruleset);
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId);
    state.players[0]!.hand.push(equipmentId);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start', actorId: 'p1' }, { controllerId: 'p1' }).status).toBe('suspended');
    expect(state.effectState.pendingChoice?.options.map(({ id }) => id)).not.toContain(equipmentId);
    const snapshot = serializeSnapshot(state);

    expect(() => restoreSnapshot(snapshot)).toThrow(/dynamic card choice Snapshot requires the active ruleset/);
    expect(restoreSnapshot(snapshot, ruleset)).toEqual(state);

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

  it('rolls back all earlier hooks when a later hook fails', () => {
    const bad = hook('test:bad', 'bad', 'turn-start', 2, { kind: 'sequence', effects: [modify(2), { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } }] });
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:first', [hook('test:first', 'first', 'turn-start', 1, modify(1))]), module('test:bad', [bad])]); const state = gameFor(ruleset); const before = structuredClone(state);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' })).toMatchObject({ status: 'failed' }); expect(state).toEqual(before);
  });

  it('keeps deterministic RNG and replay results across modules', () => {
    const random = hook('test:random', 'random', 'turn-start', 1, { kind: 'random', randomId: 'coin', outcomes: [{ id: 'one', effect: modify(1) }, { id: 'three', effect: modify(3) }] });
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:random', [random]), module('test:last', [hook('test:last', 'last', 'turn-start', 2, modify(4))])]); const left = gameFor(ruleset); const right = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(left))), ruleset);
    const leftResult = dispatchLifecycle(left, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }); const rightResult = dispatchLifecycle(right, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' });
    expect(right).toEqual(left); expect(rightResult.events).toEqual(leftResult.events);
  });

  it('fails explicitly for unknown modules, hooks, and registry versions on resume', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:choice', [hook('test:choice', 'choice', 'turn-start', 1, choiceBody())])]);
    const suspended = gameFor(ruleset); dispatchLifecycle(suspended, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }); const pendingChoice = suspended.effectState.pendingChoice!;
    const cases = [
      { expected: 'UNKNOWN_MODULE', mutate: (state: typeof suspended) => { state.effectState.pendingLifecycle!.currentHook.moduleId = 'missing:module'; } },
      { expected: 'UNKNOWN_HOOK', mutate: (state: typeof suspended) => { state.effectState.pendingLifecycle!.currentHook.hookId = 'missing-hook'; } },
      { expected: 'REGISTRY_VERSION_MISMATCH', mutate: (state: typeof suspended) => { state.rulesetVersion = 'different'; } }
    ] as const;
    for (const entry of cases) { const state = structuredClone(suspended); entry.mutate(state); const before = structuredClone(state); const result = resumeLifecycleChoice(state, ruleset, 'p1', pendingChoice.executionId, pendingChoice.choiceId, 'accept'); expect(result.reason).toBe(entry.expected); expect(state).toEqual(before); }
  });

  it('rejects tampered executable choices and non-canonical hook queues on resume', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:choice', [hook('test:choice', 'choice', 'turn-start', 1, choiceBody())])]); const suspended = gameFor(ruleset); dispatchLifecycle(suspended, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }); const pending = suspended.effectState.pendingChoice!;
    const alteredEffect = structuredClone(suspended); (alteredEffect.effectState.pendingChoice!.options[0]!.effect as Extract<EffectDefinition['body'], { kind: 'modify-value' }>).amount = 999; const effectBefore = structuredClone(alteredEffect);
    expect(resumeLifecycleChoice(alteredEffect, ruleset, 'p1', pending.executionId, pending.choiceId, 'accept')).toMatchObject({ status: 'failed' }); expect(alteredEffect).toEqual(effectBefore);
    const alteredQueue = structuredClone(suspended); alteredQueue.effectState.pendingLifecycle!.remainingHooks = [...alteredQueue.effectState.pendingLifecycle!.remainingHooks, { ...alteredQueue.effectState.pendingLifecycle!.currentHook }]; const queueBefore = structuredClone(alteredQueue);
    expect(resumeLifecycleChoice(alteredQueue, ruleset, 'p1', pending.executionId, pending.choiceId, 'accept')).toMatchObject({ status: 'failed' }); expect(alteredQueue).toEqual(queueBefore);
  });

  it('evaluates continuous boundaries without applying their card effect', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:continuous', [hook('test:continuous', 'aura', 'phase-start', 1, modify(99), 'continuous')])]); const state = gameFor(ruleset);
    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'phase-start', phase: 'action1' }, { controllerId: 'p1' })).toMatchObject({ status: 'completed', hookIds: [], evaluatedContinuousHookIds: ['aura'] }); expect(state.players[0]!.turnPurchaseBonus).toBe(0);
  });

  it('wires command and filtered enemy-defeated lifecycle boundaries through the authoritative reducer', () => {
    const before = hook('test:command', 'before', 'command-before', 1, modify(1)); const after = hook('test:command', 'after', 'command-after', 1, modify(2));
    const reward = hook('test:reward', 'reward', 'event-after', 1, { kind: 'grant-combat-reward', recipient: { kind: 'controller' }, rewards: [{ kind: 'counter', resourceId: 'test:reward', amount: 3 }, { kind: 'purchase-bonus', amount: 4 }] }); reward.eventType = 'ENEMY_DEFEATED';
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:command', [before, after]), module('test:reward', [reward])]); const state = gameFor(ruleset); state.phase = 'combat'; const targetId = Object.values(state.enemyTargets).find((target) => target.kind === 'monster')!.targetId;
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.turnPurchaseBonus).toBe(7); expect(result.state.players[0]!.counters).toContainEqual({ resourceId: 'test:reward', amount: 3, visibility: 'ownerOnly' }); expect(result.events.some((entry) => entry.type === 'COMBAT_REWARD_GRANTED')).toBe(true);
  });

  it('executes content-owned equipment triggers once per attached actor instance in party-slot order', () => {
    const ruleset = createRuleset([equipmentTriggerPack()], [baseRulesModule]);
    const state = gameFor(ruleset);
    const equipmentIds = Object.values(state.cards).filter(({ definitionId }) => definitionId === 'test:item/spear').map(({ id }) => id);
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => !equipmentIds.includes(id));
    state.players[0]!.party[0]!.equipmentId = equipmentIds[1]!;
    state.players[0]!.party[1]!.equipmentId = equipmentIds[0]!;
    state.players[1]!.party[0]!.equipmentId = equipmentIds[2]!;
    state.players[0]!.drawPile.push(...state.players[0]!.hand.splice(-2));
    const handBefore = state.players[0]!.hand.length;
    const otherHandBefore = state.players[1]!.hand.length;

    const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'event-after', eventType: 'ENEMY_DEFEATED', actorId: 'p1' }, { controllerId: 'p1' });

    expect(result.status).toBe('completed');
    expect(result.hookIds).toEqual([
      `equipment:${equipmentIds[1]}:draw-after-defeat`,
      `equipment:${equipmentIds[0]}:draw-after-defeat`,
    ]);
    expect(result.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(2);
    expect(state.players[0]!.hand).toHaveLength(handBefore + 2);
    expect(state.players[1]!.hand).toHaveLength(otherHandBefore);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
  });

  it('rolls equipment event effects back when a later module hook fails at the same boundary', () => {
    const bad = hook('test:bad-after-equipment', 'bad', 'event-after', 1, { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } });
    bad.eventType = 'ENEMY_DEFEATED';
    const ruleset = createRuleset([equipmentTriggerPack(modify(3))], [baseRulesModule, module('test:bad-after-equipment', [bad])]);
    const state = gameFor(ruleset);
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId);
    state.players[0]!.party[0]!.equipmentId = equipmentId;
    const before = structuredClone(state);

    expect(dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'event-after', eventType: 'ENEMY_DEFEATED', actorId: 'p1' }, { controllerId: 'p1' })).toMatchObject({ status: 'failed', events: [] });
    expect(state).toEqual(before);
  });

  it('applies the schema-v1 equipment-before-module precedence independently of cross-domain priority values', () => {
    const moduleHook = hook('test:after-equipment', 'module-after-equipment', 'event-after', -100, modify(4));
    moduleHook.eventType = 'ENEMY_DEFEATED';
    const ruleset = createRuleset([equipmentTriggerPack(modify(3))], [baseRulesModule, module('test:after-equipment', [moduleHook])]);
    const state = gameFor(ruleset);
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId);
    state.players[0]!.party[0]!.equipmentId = equipmentId;

    const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'event-after', eventType: 'ENEMY_DEFEATED', actorId: 'p1' }, { controllerId: 'p1' });

    expect(result).toMatchObject({ status: 'completed', hookIds: [`equipment:${equipmentId}:draw-after-defeat`, 'module-after-equipment'] });
    expect(state.players[0]!.turnPurchaseBonus).toBe(7);
  });

  it('rejects equipment triggers on non-equipment cards and every suspending trigger program', () => {
    const source = equipmentTriggerPack();
    const wrongType: ContentPack = { ...source, definitions: source.definitions.map((definition) => definition.id === 'test:item/spear' ? { ...definition, type: 'item' } : definition) };
    expect(() => createRuleset([wrongType], [baseRulesModule])).toThrow('Only equipment definitions');
    expect(() => createRuleset([equipmentTriggerPack(choiceBody())], [baseRulesModule])).toThrow('must be immediate');
    const nonCanonical: ContentPack = { ...source, definitions: source.definitions.map((definition) => definition.id === 'test:item/spear' ? { ...definition, equipmentEventTriggers: definition.equipmentEventTriggers!.map((trigger) => ({ ...trigger, eventType: ' ENEMY_DEFEATED' })) } : definition) };
    expect(() => createRuleset([nonCanonical], [baseRulesModule])).toThrow('leading or trailing whitespace');
    const duplicatePriority: ContentPack = { ...source, definitions: source.definitions.map((definition) => definition.id === 'test:item/spear' ? { ...definition, equipmentEventTriggers: [definition.equipmentEventTriggers![0]!, { ...definition.equipmentEventTriggers![0]!, triggerId: 'second-trigger' }] } : definition) };
    expect(() => createRuleset([duplicatePriority], [baseRulesModule])).toThrow('distinct explicit priorities');
  });

  it('suspends a command-before hook and rolls back a failing event hook with the command', () => {
    const suspends = hook('test:before', 'choose', 'command-before', 1, choiceBody()); const rejectRuleset = createRuleset([testPack], [baseRulesModule, module('test:before', [suspends])]); const rejectState = gameFor(rejectRuleset); const rejectBefore = structuredClone(rejectState);
    const suspended = dispatch(rejectState, rejectRuleset, envelope(rejectState, 'p1', { type: 'END_PHASE', phase: 'action1' })); expect(suspended.error).toBeUndefined(); expect(suspended.state.effectState.pendingCommand).toBeDefined(); expect(rejectState).toEqual(rejectBefore);
    const bad = hook('test:bad', 'bad', 'event-after', 1, { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } }); bad.eventType = 'ENEMY_DEFEATED'; const rollbackRuleset = createRuleset([testPack], [baseRulesModule, module('test:bad', [bad])]); const rollbackState = gameFor(rollbackRuleset); rollbackState.phase = 'combat'; const targetId = Object.values(rollbackState.enemyTargets).find((target) => target.kind === 'monster')!.targetId; const rollbackBefore = structuredClone(rollbackState);
    expect(dispatch(rollbackState, rollbackRuleset, envelope(rollbackState, 'p1', { type: 'ATTACK_TARGET', targetId })).error?.code).toBe('INVALID_COMMAND'); expect(rollbackState).toEqual(rollbackBefore);
  });

  it('resumes a command exactly once after a command-before choice Snapshot round-trip', () => {
    const before = hook('test:before', 'choose', 'command-before', 1, choiceBody(1)); const after = hook('test:after', 'after', 'command-after', 1, modify(2)); const ruleset = createRuleset([testPack], [baseRulesModule, module('test:before', [before]), module('test:after', [after])]); const state = gameFor(ruleset);
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' })); expect(suspended.error).toBeUndefined(); expect(suspended.state.revision).toBe(0); expect(suspended.state.effectState.pendingCommand?.envelope.command.type).toBe('END_PHASE');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset); const choice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'accept')!;
    const result = dispatch(restored, ruleset, envelope(restored, 'p1', choice)); expect(result.error).toBeUndefined(); expect(result.state.revision).toBe(1); expect(result.state.phase).toBe('combat'); expect(result.state.players[0]!.turnPurchaseBonus).toBe(3); expect(result.state.effectState).toEqual({});
  });

  it('rejects invalid registration and non-serializable hook data', () => {
    expect(() => createRuleset([testPack], [baseRulesModule, module('test:bad', [hook('test:bad', 'bad', 'turn-start', 1, modify(1), 'replacement')])])).toThrow('Replacement hooks are only valid');
    const invalid = hook('test:function', 'function', 'turn-start', 1, { kind: 'conditional', condition: { kind: 'always', value: true }, whenTrue: modify(1) }); (invalid as unknown as { callback: () => void }).callback = () => undefined;
    expect(() => createRuleset([testPack], [baseRulesModule, module('test:function', [invalid])])).toThrow('JSON-serializable data only');
  });

  it('rejects non-canonical finite JSON hook registrations before dispatch', () => {
    const nonFinite = hook('test:finite', 'finite', 'turn-start', Number.POSITIVE_INFINITY, modify(1));
    expect(() => createRuleset([testPack], [baseRulesModule, module('test:finite', [nonFinite])])).toThrow('Lifecycle hook must contain finite');
    const unknownField = hook('test:shape', 'shape', 'turn-start', 1, modify(1));
    (unknownField as unknown as { unexpected: string }).unexpected = 'reject-me';
    expect(() => createRuleset([testPack], [baseRulesModule, module('test:shape', [unknownField])])).toThrow('Lifecycle hook invalid');
  });

  it('does not let stale or illegal commands mutate or bypass a pending lifecycle', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, module('test:choice', [hook('test:choice', 'choice', 'turn-start', 1, choiceBody())])]); const state = gameFor(ruleset); dispatchLifecycle(state, ruleset, { schemaVersion: 1, point: 'turn-start' }, { controllerId: 'p1' }); const before = structuredClone(state); const choice = state.effectState.pendingChoice!;
    const stale = dispatch(state, ruleset, { ...envelope(state, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: choice.executionId, choiceId: choice.choiceId, optionId: 'accept' }), expectedRevision: state.revision + 1 });
    const blocked = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }));
    const invalid = dispatch(state, ruleset, envelope(state, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: choice.executionId, choiceId: choice.choiceId, optionId: 'missing' }));
    expect(stale.error?.code).toBe('STALE_REVISION'); expect(blocked.error?.code).toBe('INVALID_COMMAND'); expect(invalid.error?.code).toBe('INVALID_COMMAND'); expect(state).toEqual(before);
  });
});
