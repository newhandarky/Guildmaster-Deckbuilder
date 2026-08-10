import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, ContentPack, DomainEvent, EffectDefinition, GameCommand, LifecycleHook } from '@guildmaster/game-protocol';
import { createContentRegistry, createGame, createRuleset, dispatch, envelope, getLegalCommands, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseZoneIds } from '../src/model/zones.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const drawItemPack: ContentPack = {
  ...testPack,
  manifest: { ...testPack.manifest, id: 'test:card-use-effect', version: '2', hash: 'card-use-effect-v2' },
  definitions: testPack.definitions.map((definition) => {
    if (definition.id !== 'test:item/ration') return definition;
    const immediateItem = { ...definition };
    delete immediateItem.itemEffect;
    return {
      ...immediateItem,
      useEffect: {
        schemaVersion: 1,
        effectId: 'test:item/ration-draw-two',
        body: { kind: 'draw', player: { kind: 'controller' }, count: 2 },
      },
    };
  }),
};

const drawItemRuleset = createRuleset([drawItemPack], [baseRulesModule]);

const discardThenDrawPack: ContentPack = {
  ...drawItemPack,
  manifest: { ...drawItemPack.manifest, id: 'test:card-use-choice', version: '3', hash: 'card-use-choice-v3' },
  definitions: drawItemPack.definitions.map((definition) => definition.id === 'test:item/ration'
    ? {
        ...definition,
        useEffect: {
          schemaVersion: 1,
          effectId: 'test:item/discard-then-draw',
          body: {
            kind: 'sequence',
            effects: [
              {
                kind: 'choose-card',
                choiceId: 'test:item/discard-card',
                actor: { kind: 'controller' },
                from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' },
                selectedCardKey: 'discard',
                effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'discard' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } },
              },
              { kind: 'draw', player: { kind: 'controller' }, count: 2 },
            ],
          },
        },
      }
    : definition),
};

const discardThenDrawRuleset = createRuleset([discardThenDrawPack], [baseRulesModule]);

const commandBeforeChoiceHook: LifecycleHook = {
  schemaVersion: 1,
  moduleId: 'test:card-use-command-before',
  hookId: 'confirm-card-use',
  point: 'command-before',
  kind: 'trigger',
  priority: 1,
  effect: {
    schemaVersion: 1,
    effectId: 'test:card-use-command-before/confirm',
    body: {
      kind: 'choice',
      choiceId: 'test:card-use-command-before/choice',
      actor: { kind: 'controller' },
      options: [{ id: 'continue', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 } }],
    },
  },
};
const commandBeforeChoiceModule: RulesModule = { id: 'test:card-use-command-before', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [commandBeforeChoiceHook] };
const postCommandChoiceHook: LifecycleHook = {
  schemaVersion: 1,
  moduleId: 'test:card-use-post-command',
  hookId: 'confirm-post-command',
  point: 'command-after',
  kind: 'trigger',
  priority: 1,
  effect: {
    schemaVersion: 1,
    effectId: 'test:card-use-post-command/confirm',
    body: {
      kind: 'choice',
      choiceId: 'test:card-use-post-command/choice',
      actor: { kind: 'controller' },
      options: [{ id: 'finish', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 } }],
    },
  },
};
const postCommandChoiceModule: RulesModule = { id: 'test:card-use-post-command', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [postCommandChoiceHook] };

describe('data-driven card use effects', () => {
  it('accepts versioned suspension effects and rejects mixed legacy/new item effect contracts', () => {
    expect(createContentRegistry([discardThenDrawPack]).definitions['test:item/ration']?.useEffect?.body.kind).toBe('sequence');
    expect(() => createContentRegistry([{
      ...drawItemPack,
      manifest: { ...drawItemPack.manifest, id: 'test:mixed-card-use', hash: 'mixed-card-use' },
      definitions: drawItemPack.definitions.map((definition) => definition.id === 'test:item/ration'
        ? { ...definition, itemEffect: 'combat+2' as const }
        : definition),
    }])).toThrow(/cannot declare both legacy itemEffect and useEffect/);

    const hiddenDrawPileEffect = {
      kind: 'choose-card',
      choiceId: 'test:hidden-draw-pile',
      actor: { kind: 'controller' },
      from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'drawPile' },
      selectedCardKey: 'hidden',
      effect: { kind: 'draw', player: { kind: 'controller' }, count: 0 },
    } as unknown as EffectDefinition['body'];
    expect(() => createContentRegistry([{
      ...drawItemPack,
      manifest: { ...drawItemPack.manifest, id: 'test:hidden-card-choice', hash: 'hidden-card-choice' },
      definitions: drawItemPack.definitions.map((definition) => definition.id === 'test:item/ration'
        ? { ...definition, useEffect: { schemaVersion: 1 as const, effectId: 'test:hidden-card-choice', body: hiddenDrawPileEffect } }
        : definition),
    }])).toThrow(/Invalid card use effect/);
  });

  it('round-trips a dynamic card choice and commits the root item command exactly once', () => {
    const state = createGame({ gameId: 'card-use-choice', seed: 17, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, discardThenDrawRuleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.drawPile.push(...state.players[0]!.party.splice(-2).map(({ adventurerId }) => adventurerId));
    state.players[0]!.hand.push(itemId);
    const selectableIds = state.players[0]!.hand.filter((id) => id !== itemId);
    const suspended = dispatch(state, discardThenDrawRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'choice-root'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state).toMatchObject({ revision: 0, eventLogCursor: 0, effectState: { pendingCommand: { kind: 'card-use-effect', continuationId: 'card-use-effect:choice-root' } } });
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual(selectableIds);
    expect(suspended.state.players[0]!.playArea).toContain(itemId);

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), discardThenDrawRuleset);
    const legal = getLegalCommands(restored, discardThenDrawRuleset, 'p1');
    expect(legal).toHaveLength(selectableIds.length);
    const selected = selectableIds[0]!;
    const choice = legal.find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selected)!;
    const completed = dispatch(restored, discardThenDrawRuleset, envelope(restored, 'p1', choice, 'choice-resolution'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.eventLogCursor).toBe(completed.events.length);
    expect(completed.state.effectState.pendingChoice).toBeUndefined();
    expect(completed.state.effectState.pendingCommand).toBeUndefined();
    expect(completed.state.players[0]!.discardPile).toContain(selected);
    expect(completed.events.map(({ type }) => type)).toEqual(expect.arrayContaining(['EFFECT_STARTED', 'EFFECT_SUSPENDED', 'CARD_MOVED', 'CARD_DRAWN', 'EFFECT_COMPLETED', 'ITEM_USED']));
    expect(new Set(completed.events.map(({ eventId }) => eventId))).toHaveLength(completed.events.length);
  });

  it('keeps the exact suspended transaction when a resolution command has an invalid option', () => {
    const state = createGame({ gameId: 'card-use-invalid-resolution', seed: 19, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, discardThenDrawRuleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const suspended = dispatch(state, discardThenDrawRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'invalid-resolution-root'));
    const pending = suspended.state.effectState.pendingChoice!;
    const before = structuredClone(suspended.state);
    const rejected = dispatch(suspended.state, discardThenDrawRuleset, envelope(suspended.state, 'p1', {
      type: 'RESOLVE_EFFECT_CHOICE',
      executionId: pending.executionId,
      choiceId: pending.choiceId,
      optionId: 'missing-option',
    }, 'invalid-resolution-response'));

    expect(rejected.error).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(rejected.state).toEqual(before);
    expect(rejected.events).toEqual([]);
    expect(getLegalCommands(rejected.state, discardThenDrawRuleset, 'p1')).toEqual(getLegalCommands(before, discardThenDrawRuleset, 'p1'));
  });

  it('requires a ruleset to restore a pending card-use transaction', () => {
    const state = createGame({ gameId: 'card-use-ruleset-required', seed: 21, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, discardThenDrawRuleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const suspended = dispatch(state, discardThenDrawRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'ruleset-required-root'));
    const snapshot = serializeSnapshot(suspended.state);

    expect(() => restoreSnapshot(snapshot)).toThrow(/requires the active ruleset/);
    const tampered = structuredClone(snapshot);
    tampered.state.players[0]!.turnCombatBonus += 100;
    expect(() => restoreSnapshot(tampered)).toThrow(/requires the active ruleset/);
  });

  it('rejects a snapshot whose authoritative dynamic card candidates were tampered with', () => {
    const state = createGame({ gameId: 'card-use-choice-tamper', seed: 23, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, discardThenDrawRuleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const suspended = dispatch(state, discardThenDrawRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'choice-tamper-root'));
    expect(suspended.error).toBeUndefined();

    const tampered = structuredClone(serializeSnapshot(suspended.state));
    tampered.state.effectState.pendingChoice!.options[0]!.id = 'tampered-card-id';
    expect(() => restoreSnapshot(tampered, discardThenDrawRuleset)).toThrow(/Dynamic card choice/);
  });

  it('rejects non-canonical card-use checkpoints, current state, events, fact cursors, and source actors', () => {
    const state = createGame({ gameId: 'card-use-canonical-tamper', seed: 29, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, discardThenDrawRuleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const suspended = dispatch(state, discardThenDrawRuleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'canonical-tamper-root'));
    const snapshot = serializeSnapshot(suspended.state);
    const cases: Array<(tampered: typeof snapshot) => void> = [
      (tampered) => { tampered.state.players[0]!.turnCombatBonus += 100; },
      (tampered) => { const command = tampered.state.effectState.pendingCommand; if (command?.kind === 'card-use-effect') command.rollbackState.players[0]!.turnCombatBonus += 100; },
      (tampered) => { const command = tampered.state.effectState.pendingCommand; if (command?.kind === 'card-use-effect') command.events[0]!.message = 'tampered effect event'; },
      (tampered) => { const command = tampered.state.effectState.pendingCommand; if (command?.kind === 'card-use-effect') command.factStart += 1; },
      (tampered) => { const source = tampered.state.effectState.pendingChoice?.source; if (source?.player.kind === 'player-id') source.player.playerId = 'p2'; },
    ];
    for (const mutate of cases) {
      const tampered = structuredClone(snapshot);
      mutate(tampered);
      expect(() => restoreSnapshot(tampered, discardThenDrawRuleset)).toThrow();
    }
  });

  it('canonically restores a card-use suspension reached after command-before resolution', () => {
    const ruleset = createRuleset([discardThenDrawPack], [baseRulesModule, commandBeforeChoiceModule]);
    const state = createGame({ gameId: 'card-use-command-before', seed: 31, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const commandBefore = dispatch(state, ruleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'command-before-card-use-root'));
    expect(commandBefore.state.effectState.pendingCommand?.kind).toBeUndefined();
    const continueCommand = getLegalCommands(commandBefore.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const cardUse = dispatch(commandBefore.state, ruleset, envelope(commandBefore.state, 'p1', continueCommand, 'command-before-card-use-resolution'));

    expect(cardUse.error).toBeUndefined();
    expect(cardUse.state.effectState.pendingCommand).toMatchObject({ kind: 'card-use-effect', resolutionEnvelopes: [{ commandId: 'command-before-card-use-resolution' }] });
    expect(restoreSnapshot(serializeSnapshot(cardUse.state), ruleset)).toEqual(cardUse.state);
  });

  it('carries the resolution transcript through post-command suspension and rejects transcript tampering', () => {
    const ruleset = createRuleset([discardThenDrawPack], [baseRulesModule, commandBeforeChoiceModule, postCommandChoiceModule]);
    const state = createGame({ gameId: 'card-use-post-command', seed: 41, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);

    const beforeSuspension = dispatch(state, ruleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'post-chain-root'));
    const beforeChoice = getLegalCommands(beforeSuspension.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const cardSuspension = dispatch(beforeSuspension.state, ruleset, envelope(beforeSuspension.state, 'p1', beforeChoice, 'post-chain-before-resolution'));
    const cardChoice = getLegalCommands(cardSuspension.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const postSuspension = dispatch(cardSuspension.state, ruleset, envelope(cardSuspension.state, 'p1', cardChoice, 'post-chain-card-resolution'));

    expect(postSuspension.error).toBeUndefined();
    expect(postSuspension.state.effectState.pendingPostCommand).toMatchObject({
      envelope: { commandId: 'post-chain-root', command: { type: 'USE_ITEM' } },
      resolutionEnvelopes: [{ commandId: 'post-chain-before-resolution' }, { commandId: 'post-chain-card-resolution' }],
    });
    const snapshot = serializeSnapshot(postSuspension.state);
    expect(() => restoreSnapshot(snapshot)).toThrow(/requires the active ruleset/);
    const restored = restoreSnapshot(snapshot, ruleset);
    expect(restored).toEqual(postSuspension.state);

    const tamperedState = structuredClone(snapshot);
    tamperedState.state.players[0]!.turnCombatBonus += 100;
    expect(() => restoreSnapshot(tamperedState, ruleset)).toThrow(/Item post-command suspended state does not match canonical replay/);

    const duplicateId = structuredClone(snapshot);
    duplicateId.state.effectState.pendingPostCommand!.resolutionEnvelopes![1]!.commandId = 'post-chain-root';
    expect(() => restoreSnapshot(duplicateId, ruleset)).toThrow(/transcript is malformed or duplicated/);

    const postChoice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', postChoice, 'post-chain-final-resolution'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.effectState.pendingPostCommand).toBeUndefined();
  });

  it('records and canonically replays card-use resolutions across a second suspension', () => {
    const doubleChoicePack: ContentPack = {
      ...discardThenDrawPack,
      manifest: { ...discardThenDrawPack.manifest, id: 'test:double-card-choice', version: '4', hash: 'double-card-choice-v4' },
      definitions: discardThenDrawPack.definitions.map((definition) => definition.id === 'test:item/ration'
        ? {
            ...definition,
            useEffect: {
              schemaVersion: 1,
              effectId: 'test:item/double-discard',
              body: {
                kind: 'sequence',
                effects: [
                  { kind: 'choose-card', choiceId: 'test:item/first-discard', actor: { kind: 'controller' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' }, selectedCardKey: 'first', effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'first' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } } },
                  { kind: 'choose-card', choiceId: 'test:item/second-discard', actor: { kind: 'controller' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' }, selectedCardKey: 'second', effect: { kind: 'discard-card', card: { kind: 'context-card', key: 'second' }, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } } },
                ],
              },
            },
          }
        : definition),
    };
    const ruleset = createRuleset([doubleChoicePack], [baseRulesModule]);
    const state = createGame({ gameId: 'double-card-choice', seed: 37, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const firstSuspension = dispatch(state, ruleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'double-choice-root'));
    const firstChoice = getLegalCommands(firstSuspension.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const secondSuspension = dispatch(firstSuspension.state, ruleset, envelope(firstSuspension.state, 'p1', firstChoice, 'double-choice-first-resolution'));

    expect(secondSuspension.error).toBeUndefined();
    expect(secondSuspension.state.effectState.pendingChoice?.choiceId).toBe('test:item/second-discard');
    expect(secondSuspension.state.effectState.pendingCommand).toMatchObject({ kind: 'card-use-effect', resolutionEnvelopes: [{ commandId: 'double-choice-first-resolution' }] });
    const snapshot = serializeSnapshot(secondSuspension.state);
    const duplicateId = structuredClone(snapshot);
    const pendingCommand = duplicateId.state.effectState.pendingCommand;
    if (pendingCommand?.kind === 'card-use-effect') pendingCommand.resolutionEnvelopes[0]!.commandId = 'double-choice-root';
    expect(() => restoreSnapshot(duplicateId, ruleset)).toThrow(/Malformed card-use continuation/);
    const restored = restoreSnapshot(snapshot, ruleset);
    expect(restored).toEqual(secondSuspension.state);
    const secondChoice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', secondChoice, 'double-choice-second-resolution'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining([firstChoice.optionId, secondChoice.optionId]));
  });

  it('replays a suspended card-use transaction using only its committed event segment', () => {
    const players = [{ id: 'p1', name: '玩家', kind: 'human' as const }, { id: 'p2', name: 'AI', kind: 'ai' as const }];
    let seed = 1;
    let initialConfig = { gameId: 'card-use-choice-replay', seed, players, startingPlayerId: 'p1' };
    let state = createGame(initialConfig, discardThenDrawRuleset);
    const isItem = (cardId: string) => state.cards[cardId]?.definitionId === 'test:item/ration';
    while (!state.zones[baseZoneIds.itemRow]!.cardIds.some(isItem) && seed < 200) {
      seed += 1; initialConfig = { ...initialConfig, seed }; state = createGame(initialConfig, discardThenDrawRuleset);
    }
    const itemId = state.zones[baseZoneIds.itemRow]!.cardIds.find(isItem)!;
    const commands: CommandEnvelope[] = []; const expectedEvents: DomainEvent[] = [];
    const run = (command: GameCommand): void => {
      const nextEnvelope = envelope(state, state.activePlayerId, command, `card-use-choice-${commands.length + 1}`);
      const cursor = state.eventLogCursor; const result = dispatch(state, discardThenDrawRuleset, nextEnvelope);
      expect(result.error).toBeUndefined(); commands.push(nextEnvelope); state = result.state;
      const committed = state.eventLogCursor - cursor;
      if (committed > 0) expectedEvents.push(...result.events.slice(-committed));
    };
    run({ type: 'END_PHASE', phase: 'action1' }); run({ type: 'END_PHASE', phase: 'combat' }); run({ type: 'END_PHASE', phase: 'action2' });
    run({ type: 'BUY_CARD', cardId: itemId }); run({ type: 'END_PHASE', phase: 'purchase' });
    let useCardId: string | undefined;
    for (let guard = 0; guard < 40 && !useCardId; guard += 1) {
      const player = state.players.find(({ id }) => id === state.activePlayerId)!;
      useCardId = state.activePlayerId === 'p1' && state.phase === 'action1' ? player.hand.find(isItem) : undefined;
      if (!useCardId) run({ type: 'END_PHASE', phase: state.phase });
    }
    expect(useCardId).toBeDefined();
    const revision = state.revision; const cursor = state.eventLogCursor;
    run({ type: 'USE_ITEM', cardId: useCardId! });
    expect(state).toMatchObject({ revision, eventLogCursor: cursor, effectState: { pendingCommand: { kind: 'card-use-effect' } } });
    state = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), discardThenDrawRuleset);
    const choice = getLegalCommands(state, discardThenDrawRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    run(choice);
    expect(state.revision).toBe(revision + 1);
    expect(state.effectState.pendingCommand).toBeUndefined();

    const replay = replayGame({ schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(discardThenDrawRuleset), initialConfig, commands, expectedEvents, expectedFinalSnapshot: serializeSnapshot(state) }, discardThenDrawRuleset);
    expect(replay).toMatchObject({ status: 'completed', finalSnapshot: serializeSnapshot(state), events: expectedEvents });
  });

  it('replays purchase, draw, and immediate item execution deterministically', () => {
    const players = [{ id: 'p1', name: '玩家', kind: 'human' as const }, { id: 'p2', name: 'AI', kind: 'ai' as const }];
    let seed = 1;
    let initialConfig = { gameId: 'card-use-replay', seed, players, startingPlayerId: 'p1' };
    let state = createGame(initialConfig, drawItemRuleset);
    const isDrawItem = (cardId: string) => state.cards[cardId]?.definitionId === 'test:item/ration';
    while (!state.zones[baseZoneIds.itemRow]!.cardIds.some(isDrawItem) && seed < 200) {
      seed += 1;
      initialConfig = { ...initialConfig, seed };
      state = createGame(initialConfig, drawItemRuleset);
    }
    const itemId = state.zones[baseZoneIds.itemRow]!.cardIds.find(isDrawItem);
    expect(itemId).toBeDefined();

    const commands: CommandEnvelope[] = [];
    const expectedEvents: DomainEvent[] = [];
    const run = (command: GameCommand): void => {
      const nextEnvelope = envelope(state, state.activePlayerId, command, `card-use-${commands.length + 1}`);
      const result = dispatch(state, drawItemRuleset, nextEnvelope);
      expect(result.error).toBeUndefined();
      commands.push(nextEnvelope);
      expectedEvents.push(...result.events);
      state = result.state;
    };

    run({ type: 'END_PHASE', phase: 'action1' });
    run({ type: 'END_PHASE', phase: 'combat' });
    run({ type: 'END_PHASE', phase: 'action2' });
    run({ type: 'BUY_CARD', cardId: itemId! });
    run({ type: 'END_PHASE', phase: 'purchase' });

    let useCardId: string | undefined;
    for (let guard = 0; guard < 40 && !useCardId; guard += 1) {
      const player = state.players.find(({ id }) => id === state.activePlayerId)!;
      useCardId = state.activePlayerId === 'p1' && state.phase === 'action1'
        ? player.hand.find((cardId) => state.cards[cardId]?.definitionId === 'test:item/ration')
        : undefined;
      if (!useCardId) run({ type: 'END_PHASE', phase: state.phase });
    }
    expect(useCardId).toBeDefined();
    run({ type: 'USE_ITEM', cardId: useCardId! });

    expect(state.players[0]!.playArea).toContain(useCardId);
    expect(expectedEvents.map(({ type }) => type)).toEqual(expect.arrayContaining(['EFFECT_STARTED', 'CARD_DRAWN', 'EFFECT_COMPLETED', 'ITEM_USED']));
    expect(new Set(expectedEvents.map(({ eventId }) => eventId))).toHaveLength(expectedEvents.length);

    const replay = replayGame({
      schemaVersion: 1,
      protocolVersion: 1,
      registry: replayRegistryFingerprint(drawItemRuleset),
      initialConfig,
      commands,
      expectedEvents,
      expectedFinalSnapshot: serializeSnapshot(state),
    }, drawItemRuleset);
    expect(replay).toMatchObject({ status: 'completed', finalSnapshot: serializeSnapshot(state), events: expectedEvents });
  });

  it('rolls the whole command back when a registered immediate effect cannot resolve at runtime', () => {
    const failingPack: ContentPack = {
      ...drawItemPack,
      manifest: { ...drawItemPack.manifest, id: 'test:failing-card-use', hash: 'failing-card-use' },
      definitions: drawItemPack.definitions.map((definition) => definition.id === 'test:item/ration'
        ? {
            ...definition,
            useEffect: {
              schemaVersion: 1,
              effectId: 'test:item/missing-player',
              body: { kind: 'draw', player: { kind: 'player-id', playerId: 'missing-player' }, count: 2 },
            },
          }
        : definition),
    };
    const ruleset = createRuleset([failingPack], [baseRulesModule]);
    const state = createGame({ gameId: 'failing-card-use', seed: 7, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/ration')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);
    const before = structuredClone(state);
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'USE_ITEM', cardId: itemId }, 'failing-card-use'));
    expect(result.error).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
  });
});
