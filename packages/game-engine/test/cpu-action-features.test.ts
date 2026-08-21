import { describe, expect, it } from 'vitest';
import type { CombatRule, EquipmentCombatModifierRule, PartyCombatModifierRule } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, getCpuActionFeatures, getLegalCommands, restoreSnapshot, serializeSnapshot } from '../src/index.js';
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

const partyModifierRuleset = () => {
  const pack = structuredClone(testPack);
  pack.manifest = { ...pack.manifest, id: 'test:cpu-party-modifier', hash: 'cpu-party-modifier' };
  const wolf = pack.definitions.find(({ id }) => id === 'test:monster/wolf')!;
  wolf.combat = 2;
  const rule: PartyCombatModifierRule = {
    schemaVersion: 1,
    moduleId: 'test:cpu-party-power',
    ruleId: 'source-adjacent-bonus',
    priority: 1,
    sourceDefinitionIds: ['test:adventurer/a'],
    subject: 'adjacent',
    when: { kind: 'always', value: true },
    amount: { kind: 'fixed', value: 2 },
  };
  const module: RulesModule = {
    id: 'test:cpu-party-power', version: '1', partyCombatModifierRules: [rule],
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
  };
  return createRuleset([pack], [baseRulesModule, module]);
};

const participantLimitRuleset = () => {
  const rule: CombatRule = { schemaVersion: 1, moduleId: 'test:cpu-target-progress', ruleId: 'boss-first-only', priority: 1, kind: 'participant-limit', when: { kind: 'target-kind-in', kinds: ['boss'] }, maximumPartySlots: 1, reasonCode: 'FIRST_ONLY' };
  const modifier: EquipmentCombatModifierRule = { schemaVersion: 1, moduleId: 'test:cpu-target-progress', ruleId: 'spear-power', priority: 1, kind: 'combat-power-modifier', when: { kind: 'equipment-definition-in', definitionIds: ['test:item/spear'] }, amount: 2 };
  const module: RulesModule = {
    id: 'test:cpu-target-progress', version: '1', combatRules: [rule], equipmentCombatModifierRules: [modifier],
    partyCombatModifierRules: [{ schemaVersion: 1, moduleId: 'test:cpu-target-progress', ruleId: 'frontline-a-power', priority: 1, sourceDefinitionIds: ['test:adventurer/a'], subject: 'source', when: { kind: 'source-position-in', positions: [1] }, amount: { kind: 'fixed', value: 2 } }],
    lifecycleHooks: [{ schemaVersion: 1, moduleId: 'test:cpu-target-progress', hookId: 'move-a-first', point: 'event-after', eventType: 'ADVENTURER_ENTERED_PARTY', kind: 'trigger', priority: 1, activation: { kind: 'metadata-equals', key: 'commandDefinitionId', value: 'test:adventurer/a' }, effect: { schemaVersion: 1, effectId: 'test:cpu-target-progress/move-a-first', body: { kind: 'move-card', card: { kind: 'context-card', key: 'commandCard' }, from: { kind: 'context-location', key: 'commandCard' }, to: { kind: 'party', player: { kind: 'controller' }, position: 0 } } } }],
    getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled'
  };
  return createRuleset([testPack], [baseRulesModule, module]);
};

describe('public CPU action features', () => {
  it('uses the authoritative adventurer-entry lifecycle when projecting participant-limit progress', () => {
    const ruleset = participantLimitRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const incomingId = state.zones['base:adventurer-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:adventurer/a')!;
    state.zones['base:adventurer-deck']!.cardIds = state.zones['base:adventurer-deck']!.cardIds.filter((cardId) => cardId !== incomingId);
    player.hand.push(incomingId); state.cards[incomingId]!.ownerId = player.id; state.phase = 'action1';
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available')!;
    const play = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'PLAY_ADVENTURER' && command.cardId === incomingId)!;
    expect(play.targetCombatProgress.find(({ targetId }) => targetId === target.targetId)).toMatchObject({ effectiveCombatBefore: 1, effectiveCombatAfter: 4, shortfallAfter: 0, attackReadyAfter: true });
    const played = dispatch(state, ruleset, envelope(state, player.id, play.command));
    expect(played.error).toBeUndefined(); expect(played.state.players[0]!.party[0]!.adventurerId).toBe(incomingId);
    played.state.phase = 'combat';
    expect(getLegalCommands(played.state, ruleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId: target.targetId });
  });

  it('evaluates future attack readiness with combat-phase conditions', () => {
    const restriction: CombatRule = { schemaVersion: 1, moduleId: 'test:combat-phase-readiness', ruleId: 'combat-only-restriction', priority: 1, kind: 'restriction', when: { kind: 'all', conditions: [{ kind: 'phase-is', phase: 'combat' }, { kind: 'target-kind-in', kinds: ['boss'] }] }, reasonCode: 'COMBAT_PHASE_RESTRICTED' };
    const module: RulesModule = { id: 'test:combat-phase-readiness', version: '1', combatRules: [restriction], getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled' };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]); const state = makeGame(ruleset); state.phase = 'action1';
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available')!;
    const end = getCpuActionFeatures(state, ruleset, 'p1').find(({ command }) => command.type === 'END_PHASE')!;
    expect(end.targetCombatProgress.find(({ targetId }) => targetId === target.targetId)).toMatchObject({ attackReadyBefore: false, attackReadyAfter: false });
  });

  it('reports target-aware participant-limit progress and matches Legal Commands after dispatch', () => {
    const ruleset = participantLimitRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const first = player.party[0]!;
    const second = player.party[1]!;
    const equipmentId = state.zones['base:item-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:item/spear')!;
    state.zones['base:item-deck']!.cardIds = state.zones['base:item-deck']!.cardIds.filter((cardId) => cardId !== equipmentId);
    player.hand.push(equipmentId);
    state.cards[equipmentId]!.ownerId = player.id;
    state.phase = 'action1';
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available')!;

    const features = getCpuActionFeatures(state, ruleset, player.id);
    const firstEquip = features.find(({ command }) => command.type === 'EQUIP_ITEM' && command.cardId === equipmentId && command.adventurerId === first.adventurerId)!;
    const secondEquip = features.find(({ command }) => command.type === 'EQUIP_ITEM' && command.cardId === equipmentId && command.adventurerId === second.adventurerId)!;
    expect(firstEquip).toMatchObject({ schemaVersion: 2, targetCombatProgress: expect.arrayContaining([expect.objectContaining({ targetId: target.targetId, requiredCombat: 4, effectiveCombatBefore: 1, effectiveCombatAfter: 4, shortfallBefore: 3, shortfallAfter: 0, attackReadyBefore: false, attackReadyAfter: true })]) });
    expect(secondEquip.targetCombatProgress.find(({ targetId }) => targetId === target.targetId)).toMatchObject({ effectiveCombatBefore: 1, effectiveCombatAfter: 1, shortfallBefore: 3, shortfallAfter: 3, attackReadyAfter: false });

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(getCpuActionFeatures(restored, ruleset, player.id)).toEqual(features);
    const equipped = dispatch(state, ruleset, envelope(state, player.id, firstEquip.command));
    expect(equipped.error).toBeUndefined();
    equipped.state.phase = 'combat';
    expect(getLegalCommands(equipped.state, ruleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId: target.targetId });

    const hiddenOrder = structuredClone(state);
    hiddenOrder.players[1]!.drawPile.reverse();
    const hiddenFeature = getCpuActionFeatures(hiddenOrder, ruleset, player.id).find(({ command }) => JSON.stringify(command) === JSON.stringify(firstEquip.command));
    expect(hiddenFeature?.targetCombatProgress).toEqual(firstEquip.targetCombatProgress);
  });

  it('uses authoritative before/after party totals for positional modifier gain and loss', () => {
    const ruleset = partyModifierRuleset();
    const state = makeGame(ruleset);
    const player = state.players[0]!;
    const sourceId = state.zones['base:adventurer-deck']!.cardIds.find((cardId) => state.cards[cardId]!.definitionId === 'test:adventurer/a')!;
    state.zones['base:adventurer-deck']!.cardIds = state.zones['base:adventurer-deck']!.cardIds.filter((cardId) => cardId !== sourceId);
    state.cards[sourceId]!.ownerId = player.id;
    player.hand.push(sourceId);
    const retained = player.party[0]!;
    for (const slot of player.party.slice(1)) player.discardPile.push(slot.adventurerId);
    player.party = [retained];
    state.phase = 'action1';

    const play = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'PLAY_ADVENTURER' && command.cardId === sourceId);
    expect(play).toMatchObject({ partyCombatGain: 4, partyCombatLoss: 0 });

    player.hand = player.hand.filter((cardId) => cardId !== sourceId);
    player.party = [{ adventurerId: sourceId }, retained];
    state.phase = 'combat';
    const wolf = Object.values(state.enemyTargets).find(({ kind, status, cardInstanceId }) => kind === 'monster' && status === 'available' && state.cards[cardInstanceId]?.definitionId === 'test:monster/wolf')!;
    const attack = getCpuActionFeatures(state, ruleset, player.id).find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === wolf.targetId);
    expect(attack).toMatchObject({ partyCombatLoss: 4 });
  });

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
