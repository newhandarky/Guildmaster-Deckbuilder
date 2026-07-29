import { describe, expect, it } from 'vitest';
import { createGame, evaluateSupplyRowRefill } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import { testRuleset } from './fixtures.js';
describe('generic supply row refill evaluation', () => {
  it('is deterministic and does not mutate a full configured row', () => { const state = createGame({ gameId: 'supply-evaluation', seed: 3, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, testRuleset); const config = baseRulesModule.supplyRowConfigurations![0]!; const before = structuredClone(state); expect(evaluateSupplyRowRefill(state, testRuleset, config.sourceDeckZoneId, config.targetRowZoneId)).toMatchObject({ status: 'ready', evaluation: { status: 'no-refill-needed', actualDrawCount: 0 } }); expect(state).toEqual(before); });
  it('returns missing configuration explicitly', () => { const state = createGame({ gameId: 'supply-missing', seed: 4, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, testRuleset); expect(evaluateSupplyRowRefill(state, testRuleset, 'missing-deck', 'missing-row')).toMatchObject({ status: 'unsupported', reason: 'MISSING_SUPPLY_CONFIGURATION' }); });
});
