import { baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateEquipmentCombatModifiers, evaluateEquipmentEligibility, getCpuActionFeatures, getLegalCommands, getScoreboard, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
import { describe, expect, it } from 'vitest';
import { baseProvisionalOriginalFullRulesModule } from '../src/index.js';

const ruleset = () => createRuleset(
  [baseProvisionalOriginalFullContentPack],
  [baseRulesModule, baseProvisionalOriginalFullRulesModule],
  { allowProvisionalPlaytest: true },
);

function finishBondSetup(initialState: ReturnType<typeof createGame>, activeRuleset: ReturnType<typeof ruleset>) {
  let state = initialState;
  while (state.bondSetup) {
    const actorId = state.bondSetup.currentActorId;
    const command = getLegalCommands(state, activeRuleset, actorId).find(({ type }) => type === 'SELECT_BONDS');
    if (!command) throw new Error('Bond setup fixture has no legal selection.');
    const result = dispatch(state, activeRuleset, envelope(state, actorId, command));
    if (result.error) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

function gameWithTarget(definitionId: string) {
  const activeRuleset = ruleset();
  const state = finishBondSetup(createGame({
    gameId: `reward-${definitionId}`,
    seed: 17,
    players: [
      { id: 'p1', name: 'P1', kind: 'human' },
      { id: 'p2', name: 'P2', kind: 'ai' },
    ],
  }, activeRuleset), activeRuleset);
  const target = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
  const targetZone = state.zones[target.zoneId!]!;
  const targetIndex = targetZone.cardIds.indexOf(target.cardInstanceId);
  const sourceZone = state.zones['base:monster-deck']!;
  const sourceIndex = sourceZone.cardIds.findIndex((cardId) => state.cards[cardId]?.definitionId === definitionId);
  if (sourceIndex < 0) throw new Error(`Fixture deck does not contain ${definitionId}.`);
  const [replacementId] = sourceZone.cardIds.splice(sourceIndex, 1, target.cardInstanceId);
  targetZone.cardIds[targetIndex] = replacementId!;
  target.cardInstanceId = replacementId!;
  state.phase = 'combat';
  state.players[0]!.turnCombatBonus = 100;
  return { state, activeRuleset, targetId: target.targetId };
}

describe('full provisional base rules contribution', () => {
  it('registers only the first visually unambiguous card-rules batch', () => {
    expect(baseProvisionalOriginalFullRulesModule.combatRewardPolicies?.map(({ rewardPolicyId }) => rewardPolicyId)).toEqual([
      'monster-01-purchase-bonus',
      'monster-02-roll-purchase-bonus',
      'monster-03-remove-one',
      'monster-06-remove-up-to-two',
      'monster-09-draw-two',
      'monster-10-remove-hand',
      'monster-11-remove-discard',
      'monster-14-draw-one',
    ]);
    expect(baseProvisionalOriginalFullRulesModule.diceDefinitions).toEqual([{
      schemaVersion: 1,
      moduleId: 'base:provisional-original-full-rules',
      diceId: 'monster-02-reward-d6',
      sides: 6,
    }]);
    expect(baseProvisionalOriginalFullRulesModule.equipmentCombatModifierRules).toEqual([
      expect.objectContaining({ ruleId: 'adventurer-09-equipped-bonus', amount: 1, when: expect.objectContaining({ kind: 'adventurer-definition-in' }) }),
      expect.objectContaining({ ruleId: 'resource-02-melee-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-03-support-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-07-ranged-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-25-tank-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
    ]);
    expect(JSON.parse(JSON.stringify(baseProvisionalOriginalFullRulesModule.config))).toEqual(baseProvisionalOriginalFullRulesModule.config);
  });

  it('adds adventurer 09 combat only while an equipment is actually attached', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'adventurer-09-equipped', seed: 31, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const player = state.players[0]!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-09')!.id;
    const equipmentId = player.hand.find((cardId) => state.cards[cardId]?.definitionId === 'base:starter/spirit-crystal')!;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId);
    const displaced = player.party[0]!.adventurerId;
    player.party[0] = { adventurerId };
    player.discardPile.push(displaced);
    state.cards[adventurerId]!.ownerId = player.id;
    const input = { schemaVersion: 1 as const, playerId: player.id, equipmentCardId: equipmentId, adventurerId };
    expect(evaluateEquipmentCombatModifiers(state, activeRuleset, input)).toMatchObject({ status: 'failed', reason: 'INVALID_INPUT' });
    const command = { type: 'EQUIP_ITEM' as const, cardId: equipmentId, adventurerId };
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual(command);
    expect(getCpuActionFeatures(state, activeRuleset, player.id).find(({ command: candidate }) => candidate.type === 'EQUIP_ITEM' && candidate.cardId === equipmentId && candidate.adventurerId === adventurerId)).toMatchObject({ partyCombatGain: 2 });
    const before = structuredClone(state);
    const invalid = dispatch(state, activeRuleset, envelope(state, player.id, { ...command, adventurerId: 'missing-adventurer' }));
    expect(invalid.error?.code).toBe('INVALID_COMMAND'); expect(invalid.state).toEqual(before);
    const equipped = dispatch(state, activeRuleset, envelope(state, player.id, command));
    expect(equipped.error).toBeUndefined();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(equipped.state))), activeRuleset);
    expect(evaluateEquipmentCombatModifiers(restored, activeRuleset, input)).toMatchObject({ status: 'ready', evaluation: { powerBonus: 1, appliedRules: [{ ruleId: 'adventurer-09-equipped-bonus' }] } });
  });

  it('preserves Cat Doll negative honor in public CPU features, scoring, and Snapshot restore', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'cat-doll-negative-honor', seed: 41, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const catDollId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-06')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== catDollId);
    const itemRow = state.zones['base:item-row']!;
    const displacedId = itemRow.cardIds.splice(0, 1, catDollId)[0]!;
    state.zones['base:item-deck']!.cardIds.push(displacedId);
    state.phase = 'purchase';
    state.players[0]!.turnPurchaseBonus = 100;
    const buy = getLegalCommands(state, activeRuleset, 'p1').find((command) => command.type === 'BUY_CARD' && command.cardId === catDollId);
    expect(buy).toBeDefined();
    expect(getCpuActionFeatures(state, activeRuleset, 'p1').find(({ command }) => command.type === 'BUY_CARD' && command.cardId === catDollId)).toMatchObject({ honorGain: -1 });

    const beforeHonor = getScoreboard(state, activeRuleset).find(({ playerId }) => playerId === 'p1')!.honor;
    itemRow.cardIds = itemRow.cardIds.filter((cardId) => cardId !== catDollId);
    state.players[0]!.discardPile.push(catDollId);
    state.cards[catDollId]!.ownerId = 'p1';
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    expect(getScoreboard(restored, activeRuleset).find(({ playerId }) => playerId === 'p1')!.honor).toBe(beforeHonor - 1);
  });

  it.each([
    ['base:resource/resource-02', 'base:adventurer/adventurer-06', 'resource-02-melee-bonus'],
    ['base:resource/resource-03', 'base:adventurer/adventurer-05', 'resource-03-support-bonus'],
    ['base:resource/resource-07', 'base:adventurer/adventurer-07', 'resource-07-ranged-bonus'],
    ['base:resource/resource-25', 'base:adventurer/adventurer-04', 'resource-25-tank-bonus'],
  ] as const)('adds exactly one combat for matching equipment %s', (equipmentDefinitionId, adventurerDefinitionId, ruleId) => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: `equipment-bonus-${ruleId}`, seed: 29, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const player = state.players[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === equipmentDefinitionId)!.id;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === adventurerDefinitionId)!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId && cardId !== adventurerId);
    const displacedId = player.party[0]!.adventurerId;
    player.party[0] = { adventurerId, equipmentId };
    player.discardPile.push(displacedId);
    state.cards[equipmentId]!.ownerId = player.id;
    state.cards[adventurerId]!.ownerId = player.id;

    expect(evaluateEquipmentCombatModifiers(state, activeRuleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: equipmentId, adventurerId })).toMatchObject({
      status: 'ready',
      evaluation: {
        powerBonus: 1,
        appliedRules: [{ moduleId: 'base:provisional-original-full-rules', ruleId }],
      },
    });
  });

  it('removes every equipment command for adventurer 02 and rejects direct dispatch without mutation', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'equipment-restriction', seed: 23, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const player = state.players[0]!;
    const equipmentId = player.hand.find((cardId) => state.cards[cardId]?.definitionId === 'base:starter/spirit-crystal')!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-02')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId);
    const displaced = player.party[0]!.adventurerId;
    player.party[0] = { adventurerId };
    player.discardPile.push(displaced);
    state.cards[adventurerId]!.ownerId = player.id;
    state.phase = 'action1';
    const input = { schemaVersion: 1 as const, playerId: player.id, equipmentCardId: equipmentId, adventurerId };
    expect(evaluateEquipmentEligibility(state, activeRuleset, input)).toMatchObject({ status: 'ready', evaluation: { eligible: false, rejectionReasonCodes: ['ADVENTURER_CANNOT_EQUIP'] } });
    const command = { type: 'EQUIP_ITEM' as const, cardId: equipmentId, adventurerId };
    expect(getLegalCommands(state, activeRuleset, player.id)).not.toContainEqual(command);
    const before = structuredClone(state);
    const result = dispatch(state, activeRuleset, envelope(state, player.id, command));
    expect(result.error?.code).toBe('INVALID_COMMAND');
    expect(result.state).toEqual(before);
  });

  it.each([
    ['base:monster/monster-09', 2],
    ['base:monster/monster-14', 1],
  ] as const)('lets the player activate the printed draw reward for %s', (definitionId, drawCount) => {
    const { state, activeRuleset, targetId } = gameWithTarget(definitionId);
    state.players[0]!.discardPile.push(...state.players[0]!.hand.splice(0, drawCount));
    const beforeHand = state.players[0]!.hand.length;
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const activate = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const result = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', activate));
    expect(result.error).toBeUndefined(); expect(result.state.players[0]!.hand).toHaveLength(beforeHand + drawCount);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_REWARD_POLICY_EXECUTED' }));
  });

  it('lets monster 01 grant purchase power and keeps its existing supply-cycle disposition', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-01');
    const targetCardId = state.enemyTargets[targetId]!.cardInstanceId;
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const activate = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const result = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', activate));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.turnPurchaseBonus).toBe(1);
    expect(result.state.players[0]!.discardPile).not.toContain(targetCardId);
    expect(result.state.zones['base:monster-deck']!.cardIds).toContain(targetCardId);
  });

  it('lets monster 02 roll a d6 and grants half the face rounded up as purchase power', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-02');
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const activate = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const result = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', activate));
    expect(result.error).toBeUndefined();
    const rollEvent = result.events.find(({ type }) => type === 'DIE_ROLLED');
    const face = Number((rollEvent?.payload as { evaluation?: { face?: number } } | undefined)?.evaluation?.face);
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(6);
    expect(result.state.players[0]!.turnPurchaseBonus).toBe(Math.ceil(face / 2));
  });

  it.each([
    'base:monster/monster-01',
    'base:monster/monster-02',
    'base:monster/monster-09',
    'base:monster/monster-14',
  ] as const)('lets the player skip the one-shot reward for %s without advancing RNG', (definitionId) => {
    const { state, activeRuleset, targetId } = gameWithTarget(definitionId);
    const beforeRng = state.rngState; const beforeHand = state.players[0]!.hand.length; const beforePurchase = state.players[0]!.turnPurchaseBonus;
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(attacked.state))), activeRuleset);
    const skip = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const result = dispatch(restored, activeRuleset, envelope(restored, 'p1', skip));
    expect(result.error).toBeUndefined(); expect(result.state.rngState).toBe(beforeRng); expect(result.state.players[0]!.hand).toHaveLength(beforeHand); expect(result.state.players[0]!.turnPurchaseBonus).toBe(beforePurchase); expect(result.state.enemyTargets[targetId]!.status).toBe('defeated');
  });

  it.each([
    ['base:monster/monster-03', 'hand'],
    ['base:monster/monster-11', 'discardPile'],
  ] as const)('removes one selected card from the printed source for %s after Snapshot restore', (definitionId, source) => {
    const { state, activeRuleset, targetId } = gameWithTarget(definitionId);
    const player = state.players[0]!;
    if (source === 'discardPile' && !player.discardPile.length) player.discardPile.push(player.hand.pop()!);
    const selectedId = player[source][0]!;
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(attacked.error).toBeUndefined(); expect(attacked.state.effectState.pendingChoice?.decisionKind).toBe('remove-card');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(attacked.state))), activeRuleset);
    const choice = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selectedId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', choice));
    expect(completed.error).toBeUndefined(); expect(completed.state.removedCards).toContain(selectedId);
    expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
  });

  it('lets monster 10 resolve through an explicit skip with zero hand candidates and rejects a forged option atomically', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-10');
    const player = state.players[0]!;
    player.discardPile.push(...player.hand.splice(0));
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(attacked.error).toBeUndefined();
    const legal = getLegalCommands(attacked.state, activeRuleset, 'p1');
    expect(legal).toEqual([{ type: 'RESOLVE_EFFECT_CHOICE', executionId: attacked.state.effectState.pendingChoice!.executionId, choiceId: 'base:monster/monster-10-remove-hand', optionId: 'base:monster/monster-10-remove-hand:skip' }]);
    const pending = attacked.state.effectState.pendingChoice!;
    const forged = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'not-a-candidate' }));
    expect(forged.error?.code).toBe('INVALID_COMMAND');
    expect(forged.state.revision).toBe(state.revision);
    expect(forged.state.enemyTargets[targetId]!.status).toBe('available');
    expect(forged.state.effectState.pendingChoice).toBeUndefined();
    const completed = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', legal[0]!));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
  });

  it('lets monster 06 remove one card and then skip the second optional removal', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-06');
    const selectedId = state.players[0]!.hand[0]!;
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    const first = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selectedId)!;
    const removed = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', first, 'monster-06-first-choice'));
    expect(removed.error).toBeUndefined(); expect(removed.state.removedCards).toContain(selectedId);
    expect(removed.state.effectState.pendingCommand).toMatchObject({ kind: 'combat-reward', resolutionEnvelopes: [expect.objectContaining({ command: first })] });
    const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(removed.state)));
    const tampered = structuredClone(snapshot); tampered.state.players[0].turnPurchaseBonus += 1;
    expect(() => restoreSnapshot(tampered, activeRuleset)).toThrow(/combat reward/i);
    const restored = restoreSnapshot(snapshot, activeRuleset);
    const second = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', second));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
  });
});
