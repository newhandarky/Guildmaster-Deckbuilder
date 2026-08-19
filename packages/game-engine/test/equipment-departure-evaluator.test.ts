import { describe, expect, it } from 'vitest';
import type { EquipmentDeparturePolicy } from '@guildmaster/game-protocol';
import { createGame, createRuleset, evaluateEquipmentDeparture, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const policy = (policyId = 'remove-spear', priority = 10): EquipmentDeparturePolicy => ({
  schemaVersion: 1,
  moduleId: 'test:equipment-departure',
  policyId,
  priority,
  equipmentDefinitionIds: ['test:item/spear'],
  cause: 'combat-discard',
  disposition: 'remove-from-game',
  reasonCode: 'TEST_COMBAT_REMOVAL',
});

const module = (policies: readonly EquipmentDeparturePolicy[]): RulesModule => ({
  id: 'test:equipment-departure', version: '1', equipmentDeparturePolicies: policies,
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
});

function fixture(policies: readonly EquipmentDeparturePolicy[] = [policy()]) {
  const ruleset = createRuleset([testPack], [baseRulesModule, module(policies)]);
  const state = createGame({ gameId: 'equipment-departure', seed: 7, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
  const player = state.players[0]!;
  const slot = player.party[0]!;
  const equipmentCardId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentCardId);
  for (const candidate of state.players) {
    candidate.hand = candidate.hand.filter((cardId) => cardId !== equipmentCardId);
    candidate.drawPile = candidate.drawPile.filter((cardId) => cardId !== equipmentCardId);
    candidate.discardPile = candidate.discardPile.filter((cardId) => cardId !== equipmentCardId);
    candidate.playArea = candidate.playArea.filter((cardId) => cardId !== equipmentCardId);
  }
  slot.equipmentId = equipmentCardId;
  state.cards[equipmentCardId]!.ownerId = player.id;
  return { state, ruleset, input: { schemaVersion: 1 as const, playerId: player.id, adventurerId: slot.adventurerId, equipmentCardId, cause: 'combat-discard' as const } };
}

describe('equipment departure policy evaluator', () => {
  it('selects a JSON-only combat replacement and defaults every other cause to discard', () => {
    const { state, ruleset, input } = fixture();
    const before = structuredClone(state);
    expect(evaluateEquipmentDeparture(state, ruleset, input)).toMatchObject({ status: 'ready', evaluation: { disposition: 'remove-from-game', reasonCode: 'TEST_COMBAT_REMOVAL', appliedPolicy: { policyId: 'remove-spear' } } });
    expect(evaluateEquipmentDeparture(state, ruleset, { ...input, cause: 'rest-discard' })).toMatchObject({ status: 'ready', evaluation: { disposition: 'discard', reasonCode: 'BASE_EQUIPMENT_FOLLOWS_WEARER_TO_DISCARD' } });
    expect(state).toEqual(before);
  });

  it('round-trips deterministically and rejects detached or registry-mismatched inputs', () => {
    const { state, ruleset, input } = fixture();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(evaluateEquipmentDeparture(restored, ruleset, input)).toEqual(evaluateEquipmentDeparture(state, ruleset, input));
    const detached = structuredClone(state); delete detached.players[0]!.party[0]!.equipmentId;
    expect(evaluateEquipmentDeparture(detached, ruleset, input)).toMatchObject({ status: 'failed', reason: 'INVALID_INPUT' });
    const mismatched = structuredClone(state); mismatched.rulesModules[1]!.version = 'wrong';
    expect(evaluateEquipmentDeparture(mismatched, ruleset, input)).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
  });

  it('requires explicit policy order and validates policy registration', () => {
    expect(() => fixture([policy('first', 10), policy('second', 10)])).toThrow('priority 10 is ambiguous');
    expect(() => createRuleset([testPack], [baseRulesModule, module([policy(), policy()])])).toThrow('Duplicate equipment departure policy');
    expect(() => createRuleset([testPack], [baseRulesModule, module([{ ...policy(), equipmentDefinitionIds: ['test:item/spear', 'test:item/spear'] }])])).toThrow('definition IDs must be unique');
    expect(() => createRuleset([testPack], [baseRulesModule, module([{ ...policy(), equipmentDefinitionIds: ['missing'] }])])).toThrow('unknown definition');
    expect(() => createRuleset([testPack], [baseRulesModule, module([{ ...policy(), equipmentDefinitionIds: ['test:adventurer/a'] }])])).toThrow('must be equipment');
    expect(() => createRuleset([testPack], [baseRulesModule, module([policy(' padded ')])])).toThrow('leading or trailing whitespace');
    expect(() => createRuleset([testPack], [baseRulesModule, module([{ ...policy(), cause: 'unknown' } as unknown as EquipmentDeparturePolicy])])).toThrow('invalid');
    const cyclic = policy() as EquipmentDeparturePolicy & { cycle?: unknown }; cyclic.cycle = cyclic;
    expect(() => createRuleset([testPack], [baseRulesModule, module([cyclic])])).toThrow('acyclic');
  });
});
