import { describe, expect, it } from 'vitest';
import type { EquipmentCombatModifierRule } from '@guildmaster/game-protocol';
import { createGame, createRuleset, getCpuActionFeatures } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule, Ruleset } from '../src/rules/ruleset.js';
import { testPack, testRuleset } from './fixtures.js';

const makeGame = (ruleset: Ruleset = testRuleset) => createGame({ gameId: 'cpu-action-features', seed: 19, players: [{ id: 'p1', name: '玩家', kind: 'human' }, { id: 'p2', name: 'AI', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);

const equipmentModifierRuleset = () => {
  const rule: EquipmentCombatModifierRule = {
    schemaVersion: 1,
    moduleId: 'test:cpu-equipment-power',
    ruleId: 'spear-melee-bonus',
    kind: 'combat-power-modifier',
    amount: 2,
    when: { kind: 'equipment-definition-in', definitionIds: ['test:item/spear'] },
  };
  const module: RulesModule = {
    id: 'test:cpu-equipment-power',
    version: '1',
    equipmentCombatModifierRules: [rule],
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
  };
  return createRuleset([testPack], [baseRulesModule, module]);
};

describe('public CPU action features', () => {
  it('accounts for the deterministic party member and equipment lost to overflow', () => {
    const ruleset = equipmentModifierRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const starter = player.party[0]!;
    player.party = [];
    const adventurers = Object.values(state.cards).filter((card) => ruleset.registry.definitions[card.definitionId]?.type === 'adventurer');
    const incomingId = adventurers[0]!.id;
    const existing = adventurers.slice(1, 6);
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== incomingId);
    player.hand.push(incomingId);
    for (const card of existing) {
      for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== card.id);
      player.hand = player.hand.filter((id) => id !== card.id);
      player.discardPile = player.discardPile.filter((id) => id !== card.id);
      player.drawPile = player.drawPile.filter((id) => id !== card.id);
      player.party.push({ adventurerId: card.id });
    }
    player.party.push(starter);
    const first = player.party[0]!;
    const equipmentId = Object.values(state.cards).find((card) => ruleset.registry.definitions[card.definitionId]?.type === 'equipment')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== equipmentId);
    first.equipmentId = equipmentId;
    state.phase = 'action1';
    const feature = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'PLAY_ADVENTURER' && command.cardId === incomingId);
    const displacedCombat = (ruleset.registry.definitions[state.cards[first.adventurerId]!.definitionId]!.combat ?? 0)
      + (ruleset.registry.definitions[state.cards[equipmentId]!.definitionId]!.combat ?? 0)
      + 2;
    expect(feature).toMatchObject({ partyCombatLoss: displacedCombat, equipmentLoss: 1, overflowLoss: 1 });
  });

  it('uses Ruleset-aware equipment power for equip gain and consumed combat-prefix loss', () => {
    const ruleset = equipmentModifierRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const slot = player.party[0]!;
    const equipmentId = state.zones['base:item-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:item/spear')!;
    state.zones['base:item-deck']!.cardIds = state.zones['base:item-deck']!.cardIds.filter((cardId) => cardId !== equipmentId);
    player.hand.push(equipmentId);
    state.phase = 'action1';

    const equip = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'EQUIP_ITEM' && command.cardId === equipmentId && command.adventurerId === slot.adventurerId);
    expect(equip).toMatchObject({ partyCombatGain: 3 });

    player.hand = player.hand.filter((cardId) => cardId !== equipmentId);
    slot.equipmentId = equipmentId;
    state.phase = 'combat';
    const monster = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!;
    const attack = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === monster.targetId);
    expect(attack).toMatchObject({ partyCombatLoss: 4, equipmentLoss: 1 });
  });

  it('accounts for the printed power and modifier lost when replacing equipment', () => {
    const ruleset = equipmentModifierRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const slot = player.party[0]!;
    const [equippedId, replacementId] = Object.values(state.cards).filter(({ definitionId }) => definitionId === 'test:item/spear').map(({ id }) => id).slice(0, 2);
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equippedId && cardId !== replacementId);
    slot.equipmentId = equippedId!;
    player.hand.push(replacementId!);
    state.phase = 'action1';

    const replacement = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'EQUIP_ITEM' && command.cardId === replacementId && command.adventurerId === slot.adventurerId);
    expect(replacement).toMatchObject({ partyCombatGain: 3, partyCombatLoss: 3, equipmentLoss: 1 });
  });

  it('derives voluntary bond completion value only from public bond definitions and legal commands', () => {
    const pack = structuredClone(testPack);
    pack.manifest = { ...pack.manifest, id: 'test:cpu-bonds', hash: 'cpu-bonds' };
    pack.bonds = [
      { id: 'test:bond/a', name: 'A', honor: 2, requiredBosses: 0 },
      { id: 'test:bond/b', name: 'B', honor: 4, requiredBosses: 0 },
    ];
    const ruleset = createRuleset([pack], [baseRulesModule]);
    const state = makeGame(ruleset);
    const feature = getCpuActionFeatures(state, ruleset, 'p1').find(({ command }) => command.type === 'COMPLETE_BONDS' && command.bondIds.length === 2);
    expect(feature).toMatchObject({ command: { type: 'COMPLETE_BONDS', bondIds: ['test:bond/a', 'test:bond/b'] }, bondHonorGain: 6 });
  });

  it('uses the authoritative effective purchase cost when a public modifier is active', () => {
    const module: RulesModule = {
      id: 'test:cpu-discount', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
      zoneDefinitions: [{ zoneId: 'test:cpu-discount-active', kind: 'singleSlot', visibility: 'public', rulesModuleId: 'test:cpu-discount' }],
      purchaseCostModifierRules: [{ schemaVersion: 1, moduleId: 'test:cpu-discount', ruleId: 'supply-discount', priority: 1, activation: { kind: 'definition-in-zone', zoneId: 'test:cpu-discount-active', definitionId: 'test:monster/wolf' }, target: { kind: 'definition-type-in', values: ['item', 'equipment'] }, amount: -1 }],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const state = makeGame(ruleset);
    const wolfId = state.zones['base:monster-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:monster/wolf')!;
    state.zones['base:monster-deck']!.cardIds = state.zones['base:monster-deck']!.cardIds.filter((cardId) => cardId !== wolfId);
    state.zones['test:cpu-discount-active']!.cardIds.push(wolfId);
    state.phase = 'purchase';

    const supplyCardId = state.zones['base:item-row']!.cardIds[0]!;
    const feature = getCpuActionFeatures(state, ruleset, 'p1').find(({ command }) => command.type === 'BUY_CARD' && command.cardId === supplyCardId);
    expect(feature).toMatchObject({ purchaseCost: 1 });
  });
});
