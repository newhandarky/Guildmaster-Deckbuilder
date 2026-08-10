import { baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, getLegalCommands, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
import { describe, expect, it } from 'vitest';
import { createWebRuleset, webContentModeFromPackIds } from './ruleset.js';

describe('web content modes', () => {
  it('keeps demo as the production default', () => {
    const ruleset = createWebRuleset();
    expect(ruleset.registry.packs).toEqual([expect.objectContaining({ id: 'base:demo', contentStatus: 'demo' })]);
  });

  it('requires explicit provisional permission at the engine boundary', () => {
    expect(() => createRuleset([baseProvisionalFoundationContentPack], [baseRulesModule])).toThrow(/explicit allowProvisionalPlaytest/);
    expect(createWebRuleset(undefined, 'provisional-playtest').registry.packs).toEqual([
      expect.objectContaining({ id: 'base:provisional-foundation', contentStatus: 'provisional-playtest' }),
    ]);
  });

  it('creates and restores a deterministic foundation playtest snapshot', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-mode',
      seed: 20260807,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    expect(state.zones['base:adventurer-row']?.cardIds).toHaveLength(3);
    expect(state.zones['base:item-row']?.cardIds).toHaveLength(3);
    expect(state.zones['base:monster-row']?.cardIds).toHaveLength(3);
    expect(state.zones['base:boss-row']?.cardIds).toHaveLength(1);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
  });

  it('executes the first provisional item effect through authoritative dispatch', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-item-effect',
      seed: 20260807,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-08')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    const player = state.players[0]!;
    player.drawPile.push(...player.party.splice(-2).map(({ adventurerId }) => adventurerId));
    player.hand.push(itemId);
    const handBefore = player.hand.length;
    const result = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'foundation-use-item'));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.hand).toHaveLength(handBefore + 1);
    expect(result.state.players[0]!.playArea).toContain(itemId);
    expect(result.events.map(({ type }) => type)).toEqual(expect.arrayContaining(['EFFECT_STARTED', 'CARD_DRAWN', 'EFFECT_COMPLETED', 'ITEM_USED']));
    expect(restoreSnapshot(serializeSnapshot(result.state), ruleset)).toEqual(result.state);
  });

  it.each([
    { itemDefinitionId: 'base:resource/resource-01', targetType: 'adventurer', excludedType: 'equipment' },
    { itemDefinitionId: 'base:resource/resource-05', targetType: 'equipment', excludedType: 'adventurer' },
  ])('recovers only $targetType cards for $itemDefinitionId', ({ itemDefinitionId, targetType, excludedType }) => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: `foundation-recovery-${itemDefinitionId}`,
      seed: 20260808,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find((card) => card.definitionId === itemDefinitionId)!.id;
    const targetId = Object.values(state.cards).find((card) => ruleset.registry.definitions[card.definitionId]?.type === targetType)!.id;
    const excludedId = Object.values(state.cards).find((card) => ruleset.registry.definitions[card.definitionId]?.type === excludedType && card.id !== itemId)!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== targetId && id !== excludedId);
    const player = state.players[0]!;
    player.hand.push(itemId);
    player.discardPile.push(excludedId, targetId);

    expect(getLegalCommands(state, ruleset, player.id)).toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    const suspended = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, `foundation-use-${itemDefinitionId}`));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual([targetId]);

    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const choice = getLegalCommands(restored, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === targetId)!;
    const completed = dispatch(restored, ruleset, envelope(restored, player.id, choice, `foundation-resolve-${itemDefinitionId}`));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.hand).toContain(targetId);
    expect(completed.state.players[0]!.discardPile).toContain(excludedId);
    expect(completed.state.players[0]!.playArea).toContain(itemId);
    expect(completed.state.revision).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(completed.state), ruleset)).toEqual(completed.state);
  });

  it.each([
    'base:resource/resource-01',
    'base:resource/resource-04',
    'base:resource/resource-05',
  ])('omits $itemDefinitionId when its filtered choice has no candidates', (itemDefinitionId) => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: `foundation-no-candidate-${itemDefinitionId}`,
      seed: 20260811,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find((card) => card.definitionId === itemDefinitionId)!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    state.players[0]!.hand.push(itemId);

    expect(getLegalCommands(state, ruleset, 'human-1')).not.toContainEqual({ type: 'USE_ITEM', cardId: itemId });
  });

  it('requires and discards a boss card before resource-04 draws three cards', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-discard-boss',
      seed: 20260809,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-04')!.id;
    const bossId = Object.values(state.cards).find((card) => ruleset.registry.definitions[card.definitionId]?.type === 'boss')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== bossId);
    const player = state.players[0]!;
    player.drawPile.push(...player.party.splice(-3).map(({ adventurerId }) => adventurerId));
    player.hand.push(itemId, bossId);

    const suspended = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'foundation-use-resource-04'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual([bossId]);
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const choice = getLegalCommands(restored, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === bossId)!;
    const completed = dispatch(restored, ruleset, envelope(restored, player.id, choice, 'foundation-resolve-resource-04'));

    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.discardPile).toContain(bossId);
    expect(completed.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(3);
    expect(completed.state.revision).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(completed.state), ruleset)).toEqual(completed.state);
  });

  it.each([
    { definitionId: 'base:resource/resource-10', drawCount: 2, expectedHandCount: 6 },
    { definitionId: 'base:resource/resource-17', drawCount: 3, expectedHandCount: 7 },
  ])('persists and resolves the card choice for $definitionId', ({ definitionId, drawCount, expectedHandCount }) => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: `foundation-choice-${definitionId}`,
      seed: 20260807,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find((card) => card.definitionId === definitionId)!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    const player = state.players[0]!;
    player.drawPile.push(...player.party.splice(-drawCount).map(({ adventurerId }) => adventurerId));
    player.hand.push(itemId);

    const suspended = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, `foundation-use-${definitionId}`));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state).toMatchObject({ revision: 0, eventLogCursor: 0, effectState: { pendingCommand: { kind: 'card-use-effect' } } });
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const choice = getLegalCommands(restored, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE');
    expect(choice).toBeDefined();
    const completed = dispatch(restored, ruleset, envelope(restored, player.id, choice!, `foundation-resolve-${definitionId}`));

    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.effectState.pendingChoice).toBeUndefined();
    expect(completed.state.effectState.pendingCommand).toBeUndefined();
    expect(completed.state.players[0]!.hand).toHaveLength(expectedHandCount);
    expect(completed.state.players[0]!.discardPile).toContain(choice!.optionId);
    expect(completed.events.map(({ type }) => type)).toEqual(expect.arrayContaining(['EFFECT_SUSPENDED', 'CARD_MOVED', 'CARD_DRAWN', 'EFFECT_COMPLETED', 'ITEM_USED']));
    expect(restoreSnapshot(serializeSnapshot(completed.state), ruleset)).toEqual(completed.state);
  });

  it('recovers a persisted content mode from its pack fingerprint', () => {
    expect(webContentModeFromPackIds(['base:demo'])).toBe('demo');
    expect(webContentModeFromPackIds(['base:provisional-foundation'])).toBe('provisional-playtest');
  });
});
