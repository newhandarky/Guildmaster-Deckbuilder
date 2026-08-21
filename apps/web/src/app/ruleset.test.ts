import { baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import { baseHelperZoneIds, baseHelpersRulesModule, baseProvisionalHelpersContentPack } from '@guildmaster/content-base-helpers';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, getLegalCommands, getPartyLimit, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
import { describe, expect, it } from 'vitest';
import { createWebRuleset, webContentModeFromPackIds, webGameSetupFromSnapshot } from './ruleset.js';

describe('web content modes', () => {
  it('keeps demo as the production default', () => {
    const ruleset = createWebRuleset();
    expect(ruleset.registry.packs).toEqual([expect.objectContaining({ id: 'base:demo', contentStatus: 'demo' })]);
  });

  it('composes the deterministic E2E helper fixture through state, Snapshot, Replay, and derived party capacity', () => {
    const ruleset = createWebRuleset('optional-helper');
    expect(ruleset.modules.map(({ id }) => id)).toEqual(['base:rules', 'base:helpers']);
    const initialConfig = {
      gameId: 'optional-helper-mode',
      seed: 20260820,
      players: [{ id: 'human-1', name: '你', kind: 'human' as const }, { id: 'ai-1', name: 'AI', kind: 'ai' as const }],
      startingPlayerId: 'human-1',
    };
    const state = createGame(initialConfig, ruleset);

    expect(state.rulesModules.find(({ id }) => id === 'base:helpers')?.compositionFingerprint).toBeTruthy();
    expect(state.moduleState['base:helpers']).toEqual({ schemaVersion: 1 });
    expect(state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(1);
    expect(state.players[0]!.party).toHaveLength(6);
    expect(getPartyLimit(ruleset, state, state.players[0]!)).toBe(6);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
    const replay = replayGame({
      schemaVersion: 1,
      protocolVersion: 1,
      registry: replayRegistryFingerprint(ruleset),
      initialConfig,
      commands: [],
    }, ruleset);
    if (replay.status === 'failed') throw new Error(JSON.stringify(replay.diagnostic));
    expect(replay.status).toBe('completed');
    if (replay.status === 'completed') expect(replay.finalSnapshot).toEqual(serializeSnapshot(state));
  });

  it('replays every E2E boss refill and helper rotation through the final helper', () => {
    const ruleset = createWebRuleset('optional-helper');
    const initialConfig = {
      gameId: 'optional-helper-all-bosses',
      seed: 20260726,
      players: [{ id: 'human-1', name: '你', kind: 'human' as const }, { id: 'ai-1', name: 'AI', kind: 'ai' as const }],
      startingPlayerId: 'human-1',
    };
    let state = createGame(initialConfig, ruleset);
    const initialRightmostIds = state.players.map((player) => player.party.at(-1)!.adventurerId);
    const commands: ReturnType<typeof envelope>[] = [];
    const expectedEvents: ReturnType<typeof dispatch>['events'][number][] = [];
    const apply = (command: Parameters<typeof envelope>[2], commandId: string) => {
      const commandEnvelope = envelope(state, 'human-1', command, commandId);
      const result = dispatch(state, ruleset, commandEnvelope);
      expect(result.error).toBeUndefined();
      commands.push(commandEnvelope);
      expectedEvents.push(...result.events);
      state = result.state;
    };
    apply({ type: 'END_PHASE', phase: 'action1' }, 'helper-enter-combat');
    for (let index = 0; index < 2; index += 1) {
      const boss = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available');
      if (!boss) throw new Error(`Expected boss ${index + 1} after refill.`);
      apply({ type: 'ATTACK_TARGET', targetId: boss.targetId }, `helper-defeat-boss-${index + 1}`);
    }
    expect(state.zones[baseHelperZoneIds.active]!.cardIds).toEqual([]);
    expect(state.zones[baseHelperZoneIds.retired]!.cardIds).toHaveLength(2);
    expect(state.zones['base:boss-row']!.cardIds).toEqual([]);
    expect(expectedEvents
      .filter(({ type }) => type === 'PARTY_MEMBER_DISCARDED')
      .map(({ payload }) => payload?.kind === 'team-overflow' ? payload.candidateIds[0] : undefined))
      .toEqual(initialRightmostIds);
    const replay = replayGame({
      schemaVersion: 1,
      protocolVersion: 1,
      registry: replayRegistryFingerprint(ruleset),
      initialConfig,
      commands,
      expectedEvents,
      expectedFinalSnapshot: serializeSnapshot(state),
    }, ruleset);
    if (replay.status === 'failed') throw new Error(JSON.stringify(replay.diagnostic));
    expect(replay.status).toBe('completed');
    if (replay.status === 'completed') expect(replay.finalSnapshot).toEqual(serializeSnapshot(state));
  });

  it('fixes the Batch A E2E fixture to helper 01 followed by helper 07', () => {
    const ruleset = createWebRuleset('helper-batch-a');
    const state = createGame({ gameId: 'helper-batch-a', seed: 20260726, players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }], startingPlayerId: 'human-1' }, ruleset);
    expect(state.zones[baseHelperZoneIds.active]!.cardIds.map((cardId) => state.cards[cardId]!.definitionId)).toEqual(['base:helper/helper-01']);
    expect(state.zones[baseHelperZoneIds.deck]!.cardIds.map((cardId) => state.cards[cardId]!.definitionId)).toEqual(['base:helper/helper-07']);
    expect(state.zones['base:item-row']!.cardIds.every((cardId) => ruleset.registry.definitions[state.cards[cardId]!.definitionId]!.cost === 6)).toBe(true);
  });

  it('loads helper rules only for an explicit provisional setup and derives that setup from Snapshot identity', () => {
    expect(() => createWebRuleset(undefined, { contentMode: 'demo', advancedRules: { helpers: true } })).toThrow(/require provisional/);
    const ruleset = createWebRuleset(undefined, { contentMode: 'provisional-playtest', advancedRules: { helpers: true } });
    expect(ruleset.registry.packs.map(({ id }) => id)).toEqual(['base:provisional-foundation', 'base:provisional-helpers']);
    expect(ruleset.modules.map(({ id }) => id)).toEqual(['base:rules', 'base:helpers']);
    expect(webGameSetupFromSnapshot(ruleset.registry.packs.map(({ id }) => id), ruleset.modules.map(({ id }) => id))).toEqual({
      contentMode: 'provisional-playtest',
      advancedRules: { helpers: true },
    });
    expect(() => webGameSetupFromSnapshot(['base:provisional-foundation'], ['base:rules', 'base:helpers'])).toThrow(/inconsistent/);
  });

  it('rejects an old helper Replay by registry identity instead of rewriting its history', () => {
    const oldPack = { ...baseProvisionalHelpersContentPack, manifest: { ...baseProvisionalHelpersContentPack.manifest, version: '0.1.0', hash: 'base-provisional-helpers-v1-helper-08-capacity' } };
    const oldRuleset = createRuleset([baseProvisionalFoundationContentPack, oldPack], [baseRulesModule, { ...baseHelpersRulesModule, version: '1.0.0' }], { allowProvisionalPlaytest: true });
    const initialConfig = { gameId: 'old-helper-replay', seed: 11, players: [{ id: 'human-1', name: '你', kind: 'human' as const }, { id: 'ai-1', name: 'AI', kind: 'ai' as const }], startingPlayerId: 'human-1' };
    const currentRuleset = createWebRuleset(undefined, { contentMode: 'provisional-playtest', advancedRules: { helpers: true } });
    const replay = replayGame({ schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(oldRuleset), initialConfig, commands: [] }, currentRuleset);
    expect(replay).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'REGISTRY_MISMATCH' } });
  });

  it('requires explicit provisional permission at the engine boundary', () => {
    expect(() => createRuleset([baseProvisionalFoundationContentPack], [baseRulesModule])).toThrow(/explicit allowProvisionalPlaytest/);
    expect(createWebRuleset(undefined, 'provisional-playtest').registry.packs).toEqual([
      expect.objectContaining({ id: 'base:provisional-foundation', contentStatus: 'provisional-playtest' }),
    ]);
  });

  it('creates the separate full provisional four-player ruleset with its distinct helper identity', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    expect(ruleset.registry.packs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'base:provisional-original-full', contentStatus: 'provisional-playtest' }), expect.objectContaining({ id: 'base:provisional-original-full-helpers' })]));
    expect(Object.keys(ruleset.registry.definitions)).toHaveLength(102);
    expect(ruleset.registry.bonds).toHaveLength(30);
    expect(ruleset.modules.map(({ id }) => id)).toEqual(['base:rules', 'base:helpers', 'base:provisional-original-full-rules']);
    expect(webContentModeFromPackIds(['base:provisional-original-full'])).toBe('provisional-original-full');
    expect(webGameSetupFromSnapshot(['base:provisional-original-full', 'base:provisional-original-full-helpers'], ['base:rules', 'base:provisional-original-full-rules', 'base:helpers'])).toEqual({ contentMode: 'provisional-original-full', advancedRules: { helpers: true } });
  });

  it('creates a four-player custom-adventurer ruleset with an exact replacement roster and restorable identity', () => {
    const ruleset = createWebRuleset(undefined, 'custom-adventurers-full');
    const packIds = ruleset.registry.packs.map(({ id }) => id);
    const moduleIds = ruleset.modules.map(({ id }) => id);

    expect(packIds).toEqual([
      'base:provisional-original-full',
      'custom:adventurers-full',
      'custom:adventurers-full-helpers',
    ]);
    expect(moduleIds).toEqual([
      'base:rules',
      'base:helpers',
      'custom:adventurers-full-rules',
    ]);
    expect(webContentModeFromPackIds(packIds)).toBe('custom-adventurers-full');
    expect(webGameSetupFromSnapshot(packIds, moduleIds)).toEqual({
      contentMode: 'custom-adventurers-full',
      advancedRules: { helpers: true },
    });

    const adventurerDefinitions = Object.values(ruleset.registry.definitions)
      .filter(({ type }) => type === 'adventurer');
    expect(adventurerDefinitions).toHaveLength(43);
    expect(adventurerDefinitions.every(({ id }) => id.startsWith('custom:adventurer/'))).toBe(true);
    expect('partyDefinitionIds' in ruleset.registry.starter ? ruleset.registry.starter.partyDefinitionIds : []).toEqual([
      'custom:starter/support',
      'custom:starter/melee',
      'custom:starter/mage',
      'custom:starter/tank',
      'custom:starter/ranged',
    ]);

    const state = createGame({
      gameId: 'custom-adventurers-four-player',
      seed: 20260818,
      players: [
        { id: 'human-1', name: '你', kind: 'human' },
        { id: 'ai-1', name: 'CPU 1', kind: 'ai' },
        { id: 'ai-2', name: 'CPU 2', kind: 'ai' },
        { id: 'ai-3', name: 'CPU 3', kind: 'ai' },
      ],
      startingPlayerId: 'human-1',
    }, ruleset);
    expect(state.players).toHaveLength(4);
    expect(state.players.every(({ party }) => party.every(({ adventurerId }) => state.cards[adventurerId]!.definitionId.startsWith('custom:starter/')))).toBe(true);
    expect([
      ...state.zones['base:adventurer-deck']!.cardIds,
      ...state.zones['base:adventurer-row']!.cardIds,
    ]).toHaveLength(43);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
  });

  it('keeps helper-off provisional registry identity and definition count unchanged', () => {
    const direct = createRuleset([baseProvisionalFoundationContentPack], [baseRulesModule], { allowProvisionalPlaytest: true });
    const web = createWebRuleset(undefined, { contentMode: 'provisional-playtest', advancedRules: { helpers: false } });
    const config = { gameId: 'helper-off-identity', seed: 73, players: [{ id: 'human-1', name: '你', kind: 'human' as const }, { id: 'ai-1', name: 'AI', kind: 'ai' as const }], startingPlayerId: 'human-1' };
    const directState = createGame(config, direct);
    const webState = createGame(config, web);
    expect(Object.keys(web.registry.definitions)).toHaveLength(Object.keys(direct.registry.definitions).length);
    expect(web.registry.packs).toEqual(direct.registry.packs);
    expect(webState).toEqual(directState);
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

  it('draws once per distinct profession currently represented in the party for resource-27', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-resource-27',
      seed: 20260815,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-27')!.id;
    const extraSupportId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-01')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== extraSupportId);
    const player = state.players[0]!;
    const supportSlot = player.party.find(({ adventurerId }) => ruleset.registry.definitions[state.cards[adventurerId]!.definitionId]!.tags?.includes('profession:support'))!;
    const mageSlot = player.party.find(({ adventurerId }) => ruleset.registry.definitions[state.cards[adventurerId]!.definitionId]!.tags?.includes('profession:mage'))!;
    player.drawPile.push(...player.party.filter((slot) => slot !== supportSlot && slot !== mageSlot).map(({ adventurerId }) => adventurerId));
    player.party = [supportSlot, mageSlot, { adventurerId: extraSupportId }];
    player.hand.push(itemId);
    const handBefore = player.hand.length;

    const result = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'foundation-use-resource-27'));
    expect(result.error).toBeUndefined();
    expect(result.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(2);
    expect(result.state.players[0]!.hand).toHaveLength(handBefore + 1);
    expect(result.state.players[0]!.playArea).toContain(itemId);
    expect(result.state.revision).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(result.state), ruleset)).toEqual(result.state);
  });

  it('triggers resource-18 only for attached instances whose wearer remains after combat', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-resource-18',
      seed: 20260818,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const equipmentIds = Object.values(state.cards).filter(({ definitionId }) => definitionId === 'base:resource/resource-18').map(({ id }) => id);
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => !equipmentIds.includes(id));
    const player = state.players[0]!;
    const participatingAdventurerId = player.party[0]!.adventurerId;
    player.party[0]!.equipmentId = equipmentIds[1]!;
    player.party.at(-1)!.equipmentId = equipmentIds[0]!;
    player.drawPile.push(...player.hand.splice(-2));
    state.phase = 'combat';
    const attack = getLegalCommands(state, ruleset, player.id).find((command) => command.type === 'ATTACK_TARGET');
    expect(attack).toBeDefined();
    const target = state.enemyTargets[attack!.targetId]!;
    const requiredCombat = ruleset.registry.definitions[state.cards[target.cardInstanceId]!.definitionId]!.combat!;
    const firstAdventurerCombat = ruleset.registry.definitions[state.cards[participatingAdventurerId]!.definitionId]!.combat!;
    player.turnCombatBonus = Math.max(0, requiredCombat - firstAdventurerCombat);
    const handBefore = player.hand.length;

    const result = dispatch(state, ruleset, envelope(state, player.id, attack!, 'foundation-attack-resource-18'));

    expect(result.error).toBeUndefined();
    expect(result.events.some(({ type }) => type === 'ENEMY_DEFEATED')).toBe(true);
    expect(result.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(1);
    expect(result.events.filter(({ type }) => type === 'EFFECT_STARTED')).toHaveLength(1);
    expect(result.state.players[0]!.hand).toHaveLength(handBefore + 1);
    expect(result.state.players[0]!.party.some(({ adventurerId }) => adventurerId === participatingAdventurerId)).toBe(false);
    expect(result.state.players[0]!.discardPile).toEqual(expect.arrayContaining([participatingAdventurerId, equipmentIds[1]!]));
    expect(result.state.players[0]!.party.some(({ equipmentId }) => equipmentId === equipmentIds[0])).toBe(true);
    expect(result.state.revision).toBe(1);
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
    'base:resource/resource-13',
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

  it('recovers a non-identical item while excluding adventurers, equipment, and every resource-13 copy', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-resource-13',
      seed: 20260814,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const stones = Object.values(state.cards).filter(({ definitionId }) => definitionId === 'base:resource/resource-13');
    const itemId = stones[0]!.id;
    const excludedStoneId = stones[1]!.id;
    const recoverableItemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-08')!.id;
    const mageAdventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-03')!.id;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-02')!.id;
    for (const zone of Object.values(state.zones)) {
      zone.cardIds = zone.cardIds.filter((id) => ![itemId, excludedStoneId, recoverableItemId, mageAdventurerId, equipmentId].includes(id));
    }
    const player = state.players[0]!;
    player.hand.push(itemId);
    player.discardPile.push(mageAdventurerId, equipmentId, excludedStoneId, recoverableItemId);

    expect(getLegalCommands(state, ruleset, player.id)).toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    const suspended = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'foundation-use-resource-13'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual([recoverableItemId]);

    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const choice = getLegalCommands(restored, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === recoverableItemId)!;
    const completed = dispatch(restored, ruleset, envelope(restored, player.id, choice, 'foundation-resolve-resource-13'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.hand).toContain(recoverableItemId);
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining([mageAdventurerId, equipmentId, excludedStoneId]));
    expect(completed.state.players[0]!.playArea).toContain(itemId);
    expect(completed.state.revision).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(completed.state), ruleset)).toEqual(completed.state);
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

  it('removes a resource-15 choice from hand, party, or discard pile through one canonical continuation', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-resource-15',
      seed: 20260812,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-15')!.id;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-02')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== equipmentId);
    const player = state.players[0]!;
    const discardId = player.hand.pop()!;
    player.hand.push(itemId);
    player.discardPile.push(discardId);
    const partyId = player.party[0]!.adventurerId;
    player.party[0]!.equipmentId = equipmentId;

    const suspended = dispatch(state, ruleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'foundation-use-resource-15'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice?.options.map(({ id }) => id)).toEqual([
      ...player.hand.filter((id) => id !== itemId),
      ...player.party.map(({ adventurerId }) => adventurerId),
      ...player.discardPile,
    ]);
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const choice = getLegalCommands(restored, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === partyId)!;
    const completed = dispatch(restored, ruleset, envelope(restored, player.id, choice, 'foundation-resolve-resource-15'));

    expect(completed.error).toBeUndefined();
    expect(completed.state.removedCards).toContain(partyId);
    expect(completed.state.players[0]!.discardPile).toContain(equipmentId);
    expect(completed.state.players[0]!.party.some(({ adventurerId }) => adventurerId === partyId)).toBe(false);
    expect(completed.state.players[0]!.playArea).toContain(itemId);
    expect(completed.state.revision).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(completed.state), ruleset)).toEqual(completed.state);
  });

  it('omits resource-15 when hand, party, and discard pile have no removable candidates', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-playtest');
    const state = createGame({
      gameId: 'foundation-resource-15-empty',
      seed: 20260813,
      players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }],
      startingPlayerId: 'human-1',
    }, ruleset);
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-15')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
    const player = state.players[0]!;
    state.removedCards.push(...player.hand, ...player.drawPile, ...player.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]));
    player.hand = [itemId];
    player.drawPile = [];
    player.discardPile = [];
    player.party = [];

    expect(getLegalCommands(state, ruleset, player.id)).not.toContainEqual({ type: 'USE_ITEM', cardId: itemId });
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
