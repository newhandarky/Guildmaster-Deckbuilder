import { describe, expect, it } from 'vitest';
import type { CombatParticipantDeparturePolicy } from '@guildmaster/game-protocol';
import { baseRulesModule, createGame, createRuleset, evaluateCombatParticipantDeparture, restoreSnapshot, serializeSnapshot, type RulesModule } from '../src/index.js';
import { testPack } from './fixtures.js';

const policy = (policyId = 'replace-party', priority = 10): CombatParticipantDeparturePolicy => ({
  schemaVersion: 1, moduleId: 'test:participant-departure', policyId, priority,
  targetDefinitionIds: ['test:boss/a', 'test:boss/b', 'test:boss/c', 'test:boss/d'],
  dispositions: [
    { definitionTypes: ['starter'], destination: { kind: 'remove-from-game' } },
    { definitionTypes: ['adventurer'], destination: { kind: 'shuffle-into-shared-deck', zoneId: 'base:adventurer-deck' } },
  ],
  replacementDraw: { sourceZoneId: 'base:adventurer-deck', destination: 'discardPile', count: 'participant-count' },
  reasonCode: 'TEST_REPLACE_PARTY',
});

const module = (policies: readonly CombatParticipantDeparturePolicy[]): RulesModule => ({
  id: 'test:participant-departure', version: '1', combatParticipantDeparturePolicies: policies,
  getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
});

function fixture(policies: readonly CombatParticipantDeparturePolicy[] = [policy()]) {
  const ruleset = createRuleset([testPack], [baseRulesModule, module(policies)]);
  const state = createGame({ gameId: 'participant-departure', seed: 31, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
  const target = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
  const participantCardIds = [state.players[0]!.party[0]!.adventurerId];
  return { state, ruleset, input: { schemaVersion: 1 as const, playerId: 'p1', targetId: target.targetId, participantCardIds } };
}

describe('combat participant departure evaluator', () => {
  it('returns a pure JSON plan and round-trips through Snapshot', () => {
    const { state, ruleset, input } = fixture(); const before = structuredClone(state);
    const result = evaluateCombatParticipantDeparture(state, ruleset, input);
    expect(result).toMatchObject({ status: 'ready', evaluation: { participantDispositions: [{ destination: { kind: 'remove-from-game' } }], replacementDraw: { count: 1 }, reasonCode: 'TEST_REPLACE_PARTY' } });
    expect(state).toEqual(before);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(evaluateCombatParticipantDeparture(restored, ruleset, input)).toEqual(result);
  });

  it('defaults unmatched targets to discard and rejects invalid or mismatched inputs', () => {
    const { state, ruleset, input } = fixture();
    const other = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    expect(evaluateCombatParticipantDeparture(state, ruleset, { ...input, targetId: other.targetId })).toMatchObject({ status: 'ready', evaluation: { participantDispositions: [{ destination: { kind: 'discard' } }], reasonCode: 'BASE_PARTICIPANTS_DISCARD_AFTER_COMBAT' } });
    expect(evaluateCombatParticipantDeparture(state, ruleset, { ...input, participantCardIds: ['missing'] })).toMatchObject({ status: 'failed', reason: 'INVALID_INPUT' });
    const mismatched = structuredClone(state); mismatched.rulesModules[1]!.version = 'wrong';
    expect(evaluateCombatParticipantDeparture(mismatched, ruleset, input)).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
  });

  it('validates JSON-only registration and overlapping priorities', () => {
    expect(() => fixture([policy('a', 10), policy('b', 10)])).toThrow('priority 10 is ambiguous');
    expect(() => fixture([{ ...policy(), dispositions: [...policy().dispositions, { definitionTypes: ['starter'], destination: { kind: 'discard' } }] }])).toThrow('must not overlap');
    expect(() => fixture([{ ...policy(), targetDefinitionIds: ['missing'] }])).toThrow('unknown target');
    expect(() => fixture([policy(' padded ')])).toThrow('leading or trailing whitespace');
    expect(() => fixture([{ ...policy(), replacementDraw: { sourceZoneId: 'base:item-row', destination: 'discardPile', count: 'participant-count' } }])).toThrow('must be an ordered deck');
    const cyclic = policy() as CombatParticipantDeparturePolicy & { cycle?: unknown }; cyclic.cycle = cyclic;
    expect(() => fixture([cyclic])).toThrow('acyclic');
  });
});
