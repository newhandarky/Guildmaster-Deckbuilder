import { describe, expect, it } from 'vitest';
import type { EquipmentCombatModifierRule } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, evaluateEquipmentCombatModifiers, getLegalCommands } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { testPack } from './fixtures.js';

const modifier = (tag = 'profession:melee', priority?: number): EquipmentCombatModifierRule => ({
  schemaVersion: 1,
  moduleId: 'test:equipment-power',
  ruleId: `spear-${tag}`,
  kind: 'combat-power-modifier',
  amount: 2,
  when: {
    kind: 'all',
    conditions: [
      { kind: 'equipment-definition-in', definitionIds: ['test:item/spear'] },
      { kind: 'adventurer-tag-in', tags: [tag] },
    ],
  },
  ...(priority === undefined ? {} : { priority }),
});

const rules = (...equipmentCombatModifierRules: EquipmentCombatModifierRule[]) => {
  const module: RulesModule = {
    id: 'test:equipment-power',
    version: '1',
    equipmentCombatModifierRules,
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
  };
  return createRuleset([testPack], [baseRulesModule, module]);
};

function equippedGame(ruleset: ReturnType<typeof rules>) {
  const state = createGame({ gameId: 'equipment-power', seed: 41, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
  const player = state.players[0]!;
  const adventurerId = player.party[0]!.adventurerId;
  const equipmentId = state.zones['base:item-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:item/spear')!;
  state.zones['base:item-deck']!.cardIds = state.zones['base:item-deck']!.cardIds.filter((cardId) => cardId !== equipmentId);
  player.hand.push(equipmentId);
  const equipped = dispatch(state, ruleset, envelope(state, 'p1', { type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId }));
  if (equipped.error) throw new Error(equipped.error.message);
  const removedSlots = equipped.state.players[0]!.party.splice(1);
  equipped.state.players[0]!.discardPile.push(...removedSlots.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]));
  return { state: equipped.state, equipmentId, adventurerId };
}

const monsterTarget = (state: ReturnType<typeof equippedGame>['state']) => Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;

describe('equipment combat power modifiers', () => {
  it('adds power only when both the equipment and wearer condition match', () => {
    const matchingRuleset = rules(modifier());
    const matching = equippedGame(matchingRuleset);
    const before = structuredClone(matching.state);
    expect(evaluateEquipmentCombatModifiers(matching.state, matchingRuleset, { schemaVersion: 1, playerId: 'p1', equipmentCardId: matching.equipmentId, adventurerId: matching.adventurerId })).toMatchObject({
      status: 'ready',
      evaluation: { powerBonus: 2, appliedRules: [{ moduleId: 'test:equipment-power', ruleId: 'spear-profession:melee' }] },
    });
    expect(matching.state).toEqual(before);

    const nonmatchingRuleset = rules(modifier('profession:ranged'));
    const nonmatching = equippedGame(nonmatchingRuleset);
    expect(evaluateEquipmentCombatModifiers(nonmatching.state, nonmatchingRuleset, { schemaVersion: 1, playerId: 'p1', equipmentCardId: nonmatching.equipmentId, adventurerId: nonmatching.adventurerId })).toMatchObject({ status: 'ready', evaluation: { powerBonus: 0, appliedRules: [] } });
  });

  it('shares profession-conditioned power between legal query and authoritative attack dispatch', () => {
    const matchingRuleset = rules(modifier());
    const matching = equippedGame(matchingRuleset);
    matching.state.phase = 'combat';
    const targetId = monsterTarget(matching.state);
    expect(getLegalCommands(matching.state, matchingRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    const attacked = dispatch(matching.state, matchingRuleset, envelope(matching.state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(attacked.error).toBeUndefined();
    expect(attacked.state.enemyTargets[targetId]!.status).toBe('defeated');

    const nonmatchingRuleset = rules(modifier('profession:ranged'));
    const nonmatching = equippedGame(nonmatchingRuleset);
    nonmatching.state.phase = 'combat';
    const blockedTargetId = monsterTarget(nonmatching.state);
    expect(getLegalCommands(nonmatching.state, nonmatchingRuleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: blockedTargetId });
    const before = structuredClone(nonmatching.state);
    expect(dispatch(nonmatching.state, nonmatchingRuleset, envelope(nonmatching.state, 'p1', { type: 'ATTACK_TARGET', targetId: blockedTargetId })).state).toEqual(before);
  });

  it('rejects ambiguous ordering, invalid attachment inputs, duplicate IDs, and non-JSON rule data', () => {
    const ambiguousRuleset = rules(modifier('profession:melee', 1), { ...modifier('profession:melee', 1), ruleId: 'second' });
    const ambiguous = equippedGame(ambiguousRuleset);
    expect(evaluateEquipmentCombatModifiers(ambiguous.state, ambiguousRuleset, { schemaVersion: 1, playerId: 'p1', equipmentCardId: ambiguous.equipmentId, adventurerId: ambiguous.adventurerId })).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(evaluateEquipmentCombatModifiers(ambiguous.state, ambiguousRuleset, { schemaVersion: 1, playerId: 'p1', equipmentCardId: ambiguous.equipmentId, adventurerId: 'missing' })).toMatchObject({ status: 'failed', reason: 'INVALID_INPUT' });
    expect(() => rules(modifier(), { ...modifier(), amount: 1 })).toThrow('Duplicate equipment combat modifier rule');
    const cyclic = modifier() as EquipmentCombatModifierRule & { cycle?: unknown }; cyclic.cycle = cyclic;
    expect(() => rules(cyclic)).toThrow('finite, acyclic JSON-serializable');
  });
});
