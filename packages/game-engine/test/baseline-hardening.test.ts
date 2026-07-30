import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, executeEffect, getCombatPrefix, moveCard, restoreSnapshot, serializeSnapshot, validateGameStateInvariants } from '../src/index.js';
import { refillConfiguredSupplyRows } from '../src/engine/supply.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { baseZoneIds } from '../src/model/zones.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

describe('repository baseline hardening', () => {
  it('rejects unknown runtime commands without mutation or revision advance', () => {
    const state = makeGame(); const before = structuredClone(state);
    const malformed = { ...envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }), command: { type: 'TYPO' } } as unknown as CommandEnvelope;
    const result = dispatch(state, testRuleset, malformed);
    expect(result.error?.code).toBe('INVALID_COMMAND'); expect(result.state).toEqual(before); expect(result.events).toEqual([]);
  });

  it('rejects a state with a card in two locations before command mutation', () => {
    const state = makeGame(); const cardId = state.players[0]!.hand[0]!; state.removedCards.push(cardId); const before = structuredClone(state);
    expect(validateGameStateInvariants(state).some((error) => error.includes(cardId))).toBe(true);
    expect(dispatch(state, testRuleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' })).state).toEqual(before);
  });

  it('uses no party slots when the turn combat bonus already meets the requirement', () => {
    const state = makeGame(); state.players[0]!.turnCombatBonus = 5;
    expect(getCombatPrefix(state, testRuleset, 'p1', 4)).toEqual({ slotCount: 0, power: 5 });
  });

  it('rejects movement into an occupied single-slot zone atomically', () => {
    const state = makeGame(); const cardId = state.players[0]!.hand[0]!; const before = structuredClone(state);
    const result = moveCard(state, { cardInstanceId: cardId, from: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' }, to: { kind: 'shared-zone', zoneId: baseZoneIds.bossRow }, actorId: 'p1', context: { controllerId: 'p1' }, registry: testRuleset.registry });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_DESTINATION' }); expect(state).toEqual(before);
  });

  it('rejects unknown effect nodes before execution', () => {
    const state = makeGame(); const before = structuredClone(state);
    const result = executeEffect(state, testRuleset, { schemaVersion: 1, effectId: 'bad', body: { kind: 'unknown' } } as never, { controllerId: 'p1' }, 'bad');
    expect(result.status).toBe('failed'); expect(state).toEqual(before);
  });

  it('rejects non-finite snapshots and active registry mismatches', () => {
    const state = makeGame(); state.players[0]!.turnCombatBonus = Number.POSITIVE_INFINITY; expect(() => serializeSnapshot(state)).toThrow(/finite/);
    const valid = makeGame(); const snapshot = serializeSnapshot(valid); const incompatible = createRuleset([testPack], [{ ...baseRulesModule, config: { variant: 'changed' } }]);
    expect(() => restoreSnapshot(snapshot, incompatible)).toThrow(/active ruleset/);
  });

  it('refills every configuration even when modules share a supply kind', () => {
    const extra: RulesModule = { id: 'test:extra-supply', version: '1', zoneDefinitions: [{ zoneId: 'test:monster-deck', kind: 'orderedDeck', visibility: 'public', rulesModuleId: 'test:extra-supply' }, { zoneId: 'test:monster-row', kind: 'faceUpRow', visibility: 'public', rulesModuleId: 'test:extra-supply' }], supplyRowConfigurations: [{ schemaVersion: 1, configurationId: 'test:monster-row', moduleId: 'test:extra-supply', supply: 'monster', sourceDeckZoneId: 'test:monster-deck', targetRowZoneId: 'test:monster-row', targetSize: 1, mode: 'refill-to-target' }], getPartyLimit: (_state, _player, current) => current, onSupplyDepleted: () => 'handled' };
    const ruleset = createRuleset([testPack], [baseRulesModule, extra]); const state = createGame({ gameId: 'supply', seed: 11, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset); const cardId = state.zones[baseZoneIds.monsterDeck]!.cardIds.pop()!; state.zones['test:monster-deck']!.cardIds.push(cardId);
    refillConfiguredSupplyRows(state, ruleset, []);
    expect(state.zones['test:monster-row']!.cardIds).toEqual([cardId]);
  });
});
