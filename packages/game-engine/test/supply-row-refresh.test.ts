import { describe, expect, it } from 'vitest';
import type { EffectDefinition } from '@guildmaster/game-protocol';
import { createGame, createRuleset, evaluateSupplyRowRefresh, executeEffect } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { baseZoneIds } from '../src/model/zones.js';
import { testPack } from './fixtures.js';
const refreshModule: RulesModule = { id: 'test:refresh', version: '1', getPartyLimit: (_s, _p, limit) => limit, onSupplyDepleted: () => 'handled', supplyRowRefreshPolicies: [{ schemaVersion: 1, refreshPolicyId: 'test:refresh/items', moduleId: 'test:refresh', priority: 1, supplyRowConfigurationId: 'base:item-row', destinationZoneId: baseZoneIds.itemDeck, ordering: 'reverse-bottom', refill: true, reasonCode: 'TEST_REFRESH' }] };
const ruleset = createRuleset([testPack], [baseRulesModule, refreshModule]);
function state() { return createGame({ gameId: 'refresh', seed: 12, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset); }
describe('generic supply row refresh', () => {
  it('evaluates fixed row cards and executes policy-defined destination/order/refill atomically', () => { const game = state(); const before = structuredClone(game); const evaluation = evaluateSupplyRowRefresh(game, ruleset, 'test:refresh/items'); expect(evaluation).toMatchObject({ status: 'ready', evaluation: { status: 'ready', rowCardIds: before.zones[baseZoneIds.itemRow]!.cardIds } }); const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:refresh', body: { kind: 'refresh-supply-row', refreshPolicyId: 'test:refresh/items' } }; const result = executeEffect(game, ruleset, effect, { controllerId: 'p1' }, 'refresh-1'); expect(result.status).toBe('completed'); expect(game.zones[baseZoneIds.itemRow]!.cardIds).toHaveLength(3); expect(result.events.some(({ type }) => type === 'SUPPLY_ROW_REFRESHED')).toBe(true); });
  it('rejects missing policies without mutation', () => { const game = state(); const before = structuredClone(game); const effect: EffectDefinition = { schemaVersion: 1, effectId: 'test:missing', body: { kind: 'refresh-supply-row', refreshPolicyId: 'missing' } }; expect(executeEffect(game, ruleset, effect, { controllerId: 'p1' }, 'missing').status).toBe('unsupported'); expect(game).toEqual(before); });
});
