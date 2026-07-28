import { describe, expect, it } from 'vitest';
import type { ContentPack, GameState } from '@guildmaster/game-protocol';
import { createContentRegistry, createGame, createRuleset, dispatch, envelope, getEndCondition, getScoreboard, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseZoneIds } from '../src/model/zones.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

function legacySnapshot(state: GameState): unknown {
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  legacy.sharedZones = {
    adventurerDeck: state.zones[baseZoneIds.adventurerDeck]!.cardIds, adventurerRow: state.zones[baseZoneIds.adventurerRow]!.cardIds,
    itemDeck: state.zones[baseZoneIds.itemDeck]!.cardIds, itemRow: state.zones[baseZoneIds.itemRow]!.cardIds,
    monsterDeck: state.zones[baseZoneIds.monsterDeck]!.cardIds, monsterRow: state.zones[baseZoneIds.monsterRow]!.cardIds,
    bossDeck: state.zones[baseZoneIds.bossDeck]!.cardIds, bossRow: state.zones[baseZoneIds.bossRow]!.cardIds
  };
  delete legacy.zones;
  legacy.players = state.players.map((player) => { const legacyPlayer = { ...player } as Record<string, unknown>; delete legacyPlayer.counters; delete legacyPlayer.moduleState; return legacyPlayer; });
  legacy.enemyTargets = Object.fromEntries(Object.entries(state.enemyTargets).map(([id, target]) => { const legacyTarget = { ...target } as Record<string, unknown>; delete legacyTarget.parentEncounterId; delete legacyTarget.zoneId; delete legacyTarget.attachments; delete legacyTarget.moduleState; return [id, legacyTarget]; }));
  legacy.enemyEncounters = state.enemyEncounters.map((encounter) => { const legacyEncounter = { ...encounter } as Record<string, unknown>; delete legacyEncounter.status; delete legacyEncounter.rulesModuleId; delete legacyEncounter.state; return legacyEncounter; });
  return { schemaVersion: 1, engineVersion: '0.1.0', rulesetVersion: '0.1.0', state: legacy };
}

describe('core abstraction contracts', () => {
  it('migrates a v1 snapshot and rejects malformed or unknown versions', () => {
    const migrated = restoreSnapshot(legacySnapshot(makeGame()));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.zones[baseZoneIds.monsterRow]!.kind).toBe('faceUpRow');
    expect(migrated.players[0]!.counters).toEqual([]);
    expect(() => restoreSnapshot({ schemaVersion: 2 })).toThrow();
    expect(() => restoreSnapshot({ schemaVersion: 99, state: {} })).toThrow();
  });

  it('round-trips dynamic zones, multi-target encounters, and module state', () => {
    const state = makeGame();
    state.zones['vol1:arena'] = { zoneId: 'vol1:arena', kind: 'moduleArea', cardIds: [], visibility: 'public', rulesModuleId: 'vol1:rules', metadata: { round: 1 } };
    state.enemyEncounters.push({ encounterId: 'vol1:demon', kind: 'vol1:ultimate-demon', status: 'active', rulesModuleId: 'vol1:rules', targetIds: ['vol1:left', 'vol1:right'], state: { phase: 'awakening' } });
    state.enemyTargets['vol1:left'] = { targetId: 'vol1:left', cardInstanceId: state.zones[baseZoneIds.monsterRow]!.cardIds[0]!, kind: 'vol1:part', status: 'available', parentEncounterId: 'vol1:demon', partKey: 'left', health: { current: 3, max: 5 }, attachments: [], moduleState: { shield: 1 } };
    state.enemyTargets['vol1:right'] = { ...state.enemyTargets['vol1:left']!, targetId: 'vol1:right', partKey: 'right' };
    state.moduleState['vol1:rules'] = { awakened: true };
    state.players[0]!.counters.push({ resourceId: 'vol1:hp', amount: 4, visibility: 'ownerOnly' });
    expect(restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))))).toEqual(state);
  });

  it('composes Rules Module end and scoring hooks', () => {
    const hookModule: RulesModule = { id: 'test:hooks', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', endConditions: [{ id: 'test:ready', evaluate: (state) => state.moduleState['test:hooks'] === 'ready' }], getScoreContributions: (state) => [{ playerId: state.players[0]!.id, ruleId: 'test:bonus', amount: 7, label: '測試加分' }] };
    const ruleset = createRuleset([testPack], [baseRulesModule, hookModule]);
    const state = makeGame(); state.moduleState['test:hooks'] = 'ready';
    expect(getEndCondition(ruleset, state)).toBe('test:ready');
    expect(getScoreboard(state, ruleset).find((row) => row.playerId === 'p1')!.honor).toBe(7);
  });

  it('validates Content Pack dependencies, conflicts, and replacements', () => {
    const missingDependency: ContentPack = { manifest: { id: 'test:missing', version: '1', hash: 'a', dependencies: ['not-installed'] }, definitions: [] };
    const conflict: ContentPack = { manifest: { id: 'test:conflict', version: '1', hash: 'b', conflicts: ['test:content'] }, definitions: [] };
    const replacement: ContentPack = { manifest: { id: 'test:replacement', version: '1', hash: 'c' }, definitions: [{ id: 'test:adventurer/replacement', name: '替換', type: 'adventurer', copies: 1, source: 'test' }], replacements: [{ replacesDefinitionId: 'test:adventurer/a', replacementDefinitionId: 'test:adventurer/replacement' }] };
    expect(() => createContentRegistry([testPack, missingDependency])).toThrow('Missing content dependency');
    expect(() => createContentRegistry([testPack, conflict])).toThrow('Conflicting content packs');
    const registry = createContentRegistry([testPack, replacement]);
    expect(registry.definitions['test:adventurer/a']).toBeUndefined();
    expect(registry.replacementMap['test:adventurer/a']).toBe('test:adventurer/replacement');
    const higherPriority: ContentPack = { manifest: { id: 'test:replacement-high', version: '1', hash: 'd' }, definitions: [{ id: 'test:adventurer/replacement-high', name: '高優先替換', type: 'adventurer', copies: 1, source: 'test' }], replacements: [{ replacesDefinitionId: 'test:adventurer/a', replacementDefinitionId: 'test:adventurer/replacement-high', priority: 1 }] };
    expect(createContentRegistry([testPack, replacement, higherPriority]).replacementMap['test:adventurer/a']).toBe('test:adventurer/replacement-high');
  });

  it('rejects provisional playtest packs unless a caller explicitly opts in', () => {
    const provisional: ContentPack = { ...testPack, manifest: { ...testPack.manifest, id: 'test:provisional', contentStatus: 'provisional-playtest' } };
    expect(() => createContentRegistry([provisional])).toThrow('Provisional playtest Content Packs require explicit allowProvisionalPlaytest.');
    expect(createContentRegistry([provisional], { allowProvisionalPlaytest: true }).packs[0]!.contentStatus).toBe('provisional-playtest');
    expect(() => createRuleset([provisional], [baseRulesModule])).toThrow('Provisional playtest Content Packs require explicit allowProvisionalPlaytest.');
    expect(createRuleset([provisional], [baseRulesModule], { allowProvisionalPlaytest: true }).registry.packs[0]!.contentStatus).toBe('provisional-playtest');
  });

  it('supports an explicit distinct starter-party setup while retaining legacy starter setup', () => {
    const ids = ['test:starter/adventurer', 'test:starter/adventurer-02', 'test:starter/adventurer-03', 'test:starter/adventurer-04', 'test:starter/adventurer-05'];
    const explicit: ContentPack = { ...testPack, manifest: { ...testPack.manifest, id: 'test:distinct-starters' }, definitions: [...testPack.definitions, ...ids.slice(1).map((id) => ({ id, name: id, type: 'starter', copies: 0, combat: 1, source: 'test' }))], starter: { partyDefinitionIds: ids, summonStoneDefinitionId: 'test:starter/stone', crystalDefinitionId: 'test:starter/crystal' } };
    const state = createGame({ gameId: 'distinct', seed: 4, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, createRuleset([explicit], [baseRulesModule]));
    expect(state.players[0]!.party.map((slot) => state.cards[slot.adventurerId]!.definitionId)).toEqual(ids);
  });

  it('does not mutate state for stale or illegal commands', () => {
    const state = makeGame();
    const stale = dispatch(state, testRuleset, { ...envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }), expectedRevision: 1 });
    const illegal = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'BUY_CARD', cardId: state.zones[baseZoneIds.itemRow]!.cardIds[0]! }));
    expect(stale.error?.code).toBe('STALE_REVISION'); expect(stale.state).toBe(state); expect(stale.events).toEqual([]);
    expect(illegal.error?.code).toBe('INVALID_COMMAND'); expect(illegal.state).toBe(state); expect(illegal.events).toEqual([]);
  });

  it('marks supply exhaustion as pending official ruling after the current rest completes', () => {
    const state = makeGame(); state.phase = 'combat';
    const targetId = Object.values(state.enemyTargets).find((target) => target.kind === 'monster')!.targetId;
    const defeated = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })).state;
    const action2 = dispatch(defeated, testRuleset, envelope(defeated, 'p1', { type: 'END_PHASE', phase: 'combat' })).state;
    const purchase = dispatch(action2, testRuleset, envelope(action2, 'p1', { type: 'END_PHASE', phase: 'action2' })).state;
    const rest = dispatch(purchase, testRuleset, envelope(purchase, 'p1', { type: 'END_PHASE', phase: 'purchase' })).state;
    const result = dispatch(rest, testRuleset, envelope(rest, 'p1', { type: 'END_PHASE', phase: 'rest' })).state;
    expect(result.status).toBe('pendingOfficialRuling');
    expect(result.phase).toBe('action1');
    expect(result.activePlayerId).toBe('p2');
  });
});
