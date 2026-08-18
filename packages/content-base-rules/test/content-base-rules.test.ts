import { baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateCombat, evaluateEquipmentCombatModifiers, evaluateEquipmentDeparture, evaluateEquipmentEligibility, evaluatePartyCombat, evaluatePurchaseCost, getActionPreviewSet, getCpuActionFeatures, getLegalCommands, getScoreboard, projectPlayerView, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
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

function gameWithParty(definitionIds: readonly string[]) {
  const activeRuleset = ruleset();
  const state = finishBondSetup(createGame({ gameId: `party-${definitionIds.join('-')}`, seed: 53, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, activeRuleset), activeRuleset);
  const player = state.players[0]!;
  const selectedIds = definitionIds.map((definitionId) => Object.values(state.cards).find((card) => card.definitionId === definitionId && !state.removedCards.includes(card.id))!.id);
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => !selectedIds.includes(cardId));
  for (const candidate of state.players) {
    candidate.hand = candidate.hand.filter((cardId) => !selectedIds.includes(cardId));
    candidate.drawPile = candidate.drawPile.filter((cardId) => !selectedIds.includes(cardId));
    candidate.discardPile = candidate.discardPile.filter((cardId) => !selectedIds.includes(cardId));
    candidate.playArea = candidate.playArea.filter((cardId) => !selectedIds.includes(cardId));
  }
  player.discardPile.push(...player.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentId ? [slot.equipmentId] : [])]).filter((cardId) => !selectedIds.includes(cardId)));
  player.party = selectedIds.map((adventurerId) => ({ adventurerId }));
  for (const cardId of selectedIds) state.cards[cardId]!.ownerId = player.id;
  return { state, activeRuleset, selectedIds };
}

function replaceTarget(state: ReturnType<typeof createGame>, targetKind: 'monster' | 'boss', definitionId: string) {
  const target = Object.values(state.enemyTargets).find(({ kind }) => kind === targetKind)!;
  if (state.cards[target.cardInstanceId]?.definitionId === definitionId) return target.targetId;
  const targetZone = state.zones[target.zoneId!]!;
  const sourceZone = state.zones[targetKind === 'monster' ? 'base:monster-deck' : 'base:boss-deck']!;
  const sourceIndex = sourceZone.cardIds.findIndex((cardId) => state.cards[cardId]?.definitionId === definitionId);
  const targetIndex = targetZone.cardIds.indexOf(target.cardInstanceId);
  const oldId = target.cardInstanceId;
  const [newId] = sourceZone.cardIds.splice(sourceIndex, 1, oldId);
  targetZone.cardIds[targetIndex] = newId!;
  target.cardInstanceId = newId!;
  return target.targetId;
}

function arrangePublicRow(
  state: ReturnType<typeof createGame>,
  activeRuleset: ReturnType<typeof ruleset>,
  rowId: 'base:item-row' | 'base:adventurer-row',
  deckId: 'base:item-deck' | 'base:adventurer-deck',
  matches: (definition: (typeof activeRuleset.registry.definitions)[string]) => boolean,
  withCandidates: boolean,
) {
  const row = state.zones[rowId]!; const deck = state.zones[deckId]!; const supply = [...row.cardIds, ...deck.cardIds];
  const matching = supply.filter((cardId) => matches(activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!));
  const nonmatching = supply.filter((cardId) => !matching.includes(cardId));
  const selected = withCandidates ? matching.slice(0, 2) : [];
  const arranged = withCandidates ? [...selected, (nonmatching[0] ?? matching[2])!] : nonmatching.slice(0, 3);
  expect(arranged).toHaveLength(3);
  row.cardIds = arranged; deck.cardIds = supply.filter((cardId) => !arranged.includes(cardId));
  return selected;
}

describe('full provisional base rules contribution', () => {
  it('registers only the first visually unambiguous card-rules batch', () => {
    expect(baseProvisionalOriginalFullRulesModule.combatRewardPolicies?.map(({ rewardPolicyId }) => rewardPolicyId)).toEqual([
      'boss-01-purchase-and-market-cards',
      'boss-02-purchase-and-adventurer-deck',
      'monster-01-purchase-bonus',
      'monster-02-roll-purchase-bonus',
      'monster-03-remove-one',
      'monster-06-remove-up-to-two',
      'monster-09-draw-two',
      'monster-10-remove-hand',
      'monster-11-remove-discard',
      'monster-14-draw-one',
      'boss-03-hand-adventurer-gate-and-reward',
      'boss-05-purchase-and-market-cards',
      'boss-06-purchase-and-adventurer-deck',
      'boss-08-purchase-and-adventurers',
      'boss-09-purchase-and-item-deck',
      'boss-10-purchase-and-personal-draw',
      'boss-11-purchase-and-items',
    ]);
    expect(baseProvisionalOriginalFullRulesModule.combatRules).toEqual([
      expect.objectContaining({ ruleId: 'boss-01-item-row-equipment-combat', kind: 'modifier' }),
      expect.objectContaining({ ruleId: 'boss-05-equipment-suppression', kind: 'equipment-suppression', reasonCode: 'BOSS_05_SUPPRESSES_ALL_EQUIPMENT' }),
      expect.objectContaining({ ruleId: 'boss-06-attacking-party-professions-combat', kind: 'modifier' }),
      expect.objectContaining({ ruleId: 'boss-08-three-participant-limit', kind: 'participant-limit', maximumPartySlots: 3 }),
      expect.objectContaining({ ruleId: 'boss-09-next-seat-professions-combat', kind: 'modifier' }),
      expect.objectContaining({ ruleId: 'boss-10-attacking-party-professions-combat', kind: 'modifier' }),
      expect.objectContaining({ ruleId: 'boss-11-one-participant-limit', kind: 'participant-limit', maximumPartySlots: 1 }),
    ]);
    expect(baseProvisionalOriginalFullRulesModule.combatParticipantDeparturePolicies).toEqual([
      expect.objectContaining({ policyId: 'boss-02-participant-departure', reasonCode: 'BOSS_02_REPLACES_COMBAT_PARTICIPANTS' }),
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
    expect(baseProvisionalOriginalFullRulesModule.partyCombatModifierRules?.map(({ ruleId }) => ruleId)).toEqual([
      'adventurer-04-first-other-bonus', 'adventurer-10-first-self-bonus', 'adventurer-15-rear-self-bonus',
      'adventurer-20-party-size-penalty', 'adventurer-24-monster-self-bonus', 'adventurer-27-adjacent-bonus',
    ]);
    expect(baseProvisionalOriginalFullRulesModule.purchaseCostModifierRules).toEqual([expect.objectContaining({ ruleId: 'adventurer-05-equipment-discount', amount: -1, activation: { kind: 'definition-in-player-party', player: 'evaluated-player', definitionId: 'base:adventurer/adventurer-05' } })]);
    expect(baseProvisionalOriginalFullRulesModule.equipmentDeparturePolicies).toEqual([expect.objectContaining({ policyId: 'resource-12-combat-removal', cause: 'combat-discard', disposition: 'remove-from-game', reasonCode: 'RESOURCE_12_WEARER_COMBAT_DISCARD_REMOVES_EQUIPMENT' })]);
    expect(JSON.parse(JSON.stringify(baseProvisionalOriginalFullRulesModule.config))).toEqual(baseProvisionalOriginalFullRulesModule.config);
  });

  it('removes resource 12 only when its wearer is discarded by combat across legal, CPU, dispatch, rollback and Snapshot', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-01');
    const player = state.players[0]!;
    player.turnCombatBonus = 0;
    const slot = player.party[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-12')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) {
      candidate.hand = candidate.hand.filter((cardId) => cardId !== equipmentId);
      candidate.drawPile = candidate.drawPile.filter((cardId) => cardId !== equipmentId);
      candidate.discardPile = candidate.discardPile.filter((cardId) => cardId !== equipmentId);
      candidate.playArea = candidate.playArea.filter((cardId) => cardId !== equipmentId);
    }
    slot.equipmentId = equipmentId;
    state.cards[equipmentId]!.ownerId = player.id;
    const combatInput = { schemaVersion: 1 as const, playerId: player.id, adventurerId: slot.adventurerId, equipmentCardId: equipmentId, cause: 'combat-discard' as const };
    expect(evaluateEquipmentDeparture(state, activeRuleset, combatInput)).toMatchObject({ status: 'ready', evaluation: { disposition: 'remove-from-game', appliedPolicy: { policyId: 'resource-12-combat-removal' }, reasonCode: 'RESOURCE_12_WEARER_COMBAT_DISCARD_REMOVES_EQUIPMENT' } });
    expect(evaluateEquipmentDeparture(state, activeRuleset, { ...combatInput, cause: 'team-overflow-discard' })).toMatchObject({ status: 'ready', evaluation: { disposition: 'discard', reasonCode: 'BASE_EQUIPMENT_FOLLOWS_WEARER_TO_DISCARD' } });
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toMatchObject({ equipmentLoss: 1, equipmentRemoval: 1 });
    const before = structuredClone(state);
    expect(dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId: 'missing-target' })).state).toEqual(before);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    const wearerId = restored.players[0]!.party[0]!.adventurerId;
    const result = dispatch(restored, activeRuleset, envelope(restored, player.id, { type: 'ATTACK_TARGET', targetId }));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.discardPile).toContain(wearerId);
    expect(result.state.players[0]!.discardPile).not.toContain(equipmentId);
    expect(result.state.removedCards).toContain(equipmentId);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'EQUIPMENT_REMOVED_FROM_GAME', causedByCommandId: expect.any(String) }));
    expect(result.state.effectState.pendingChoice).toBeDefined();
    const continuation = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(result.state))), activeRuleset);
    const skip = getLegalCommands(continuation, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const completed = dispatch(continuation, activeRuleset, envelope(continuation, player.id, skip));
    expect(completed.error).toBeUndefined();
    expect(completed.state.removedCards.filter((cardId) => cardId === equipmentId)).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'EQUIPMENT_REMOVED_FROM_GAME')).toHaveLength(1);
  });

  it('resolves boss 05 equipment suppression and two-card public market reward across rollback and Snapshot', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'boss-05-full-effect', seed: 71, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-05');
    const player = state.players[0]!;
    state.phase = 'combat'; player.turnCombatBonus = 3;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-12')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) {
      candidate.hand = candidate.hand.filter((cardId) => cardId !== equipmentId);
      candidate.drawPile = candidate.drawPile.filter((cardId) => cardId !== equipmentId);
      candidate.discardPile = candidate.discardPile.filter((cardId) => cardId !== equipmentId);
    }
    player.party[0]!.equipmentId = equipmentId; state.cards[equipmentId]!.ownerId = player.id;
    const itemRow = state.zones['base:item-row']!; const itemDeck = state.zones['base:item-deck']!;
    const itemSupply = [...itemRow.cardIds, ...itemDeck.cardIds];
    const eligible = itemSupply.filter((cardId) => (activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.cost ?? Number.POSITIVE_INFINITY) <= 3).slice(0, 2);
    expect(eligible).toHaveLength(2);
    const third = itemSupply.find((cardId) => !eligible.includes(cardId))!;
    itemRow.cardIds = [...eligible, third]; itemDeck.cardIds = itemSupply.filter((cardId) => !itemRow.cardIds.includes(cardId));

    expect(evaluateCombat(state, activeRuleset, player.id, targetId)).toMatchObject({ status: 'ready', evaluation: { equipmentSuppressed: true, equipmentSuppressionReasonCodes: ['BOSS_05_SUPPRESSES_ALL_EQUIPMENT'] } });
    expect(projectPlayerView(state, activeRuleset, player.id).enemyTargets[targetId]).toMatchObject({ equipmentSuppressed: true, equipmentSuppressionReasonCodes: ['BOSS_05_SUPPRESSES_ALL_EQUIPMENT'] });
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toMatchObject({ bossProgress: 1, equipmentLoss: 1, equipmentRemoval: 0 });

    const attacked = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId }, 'boss-05-root'));
    expect(attacked.error).toBeUndefined(); expect(attacked.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(attacked.state.effectState.pendingChoice).toMatchObject({ choiceId: 'base:boss/boss-05-market-reward:2', decisionKind: 'choose-market-card' });
    const pending = attacked.state.effectState.pendingChoice!;
    const forged = dispatch(attacked.state, activeRuleset, envelope(attacked.state, player.id, { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state.enemyTargets[targetId]!.status).toBe('available');
    const first = getLegalCommands(attacked.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === eligible[0])!;
    const afterFirst = dispatch(attacked.state, activeRuleset, envelope(attacked.state, player.id, first));
    expect(afterFirst.error).toBeUndefined(); expect(afterFirst.state.effectState.pendingChoice).toMatchObject({ choiceId: 'base:boss/boss-05-market-reward:1' });
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(afterFirst.state))), activeRuleset);
    const second = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === eligible[1])!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, second));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining([equipmentId, ...eligible]));
    expect(completed.state.removedCards).not.toContain(equipmentId);
    expect(completed.state.zones['base:item-row']!.cardIds).toEqual([third]);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(1);

    const emptyState = finishBondSetup(createGame({ gameId: 'boss-05-zero-candidate', seed: 73, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const emptyTargetId = replaceTarget(emptyState, 'boss', 'base:boss/boss-05'); emptyState.phase = 'combat'; emptyState.players[0]!.turnCombatBonus = 3;
    const emptyRow = emptyState.zones['base:item-row']!; const emptyDeck = emptyState.zones['base:item-deck']!; const emptySupply = [...emptyRow.cardIds, ...emptyDeck.cardIds];
    emptyRow.cardIds = emptySupply.filter((cardId) => (activeRuleset.registry.definitions[emptyState.cards[cardId]!.definitionId]!.cost ?? 0) > 3).slice(0, 3);
    expect(emptyRow.cardIds).toHaveLength(3); emptyDeck.cardIds = emptySupply.filter((cardId) => !emptyRow.cardIds.includes(cardId));
    const skipped = dispatch(emptyState, activeRuleset, envelope(emptyState, 'p1', { type: 'ATTACK_TARGET', targetId: emptyTargetId }));
    expect(skipped.error).toBeUndefined(); expect(skipped.state.effectState.pendingChoice).toBeUndefined(); expect(skipped.state.players[0]!.turnPurchaseBonus).toBe(5); expect(skipped.events.some(({ type }) => type === 'EFFECT_CHOICE_SKIPPED')).toBe(true);
  });

  it('derives boss 01 combat from the public item-row equipment count', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'boss-01-public-combat', seed: 79, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-01'); state.phase = 'combat';
    const equipmentCount = state.zones['base:item-row']!.cardIds.filter((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'equipment').length;
    expect(evaluateCombat(state, activeRuleset, 'p1', targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: 9 + equipmentCount, appliedRules: [{ ruleId: 'boss-01-item-row-equipment-combat' }] } });
    expect(projectPlayerView(state, activeRuleset, 'p1').enemyTargets[targetId]?.effectiveCombat).toBe(9 + equipmentCount);
    const before = structuredClone(state); state.enemyTargets[targetId]!.cardInstanceId = 'missing';
    expect(() => evaluateCombat(state, activeRuleset, 'p1', targetId)).toThrow();
    Object.assign(state, before);
    expect(evaluateCombat(restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset), activeRuleset, 'p1', targetId)).toEqual(evaluateCombat(state, activeRuleset, 'p1', targetId));
  });

  it.each([
    ['base:boss/boss-06', 10, 'boss-06-attacking-party-professions-combat'],
    ['base:boss/boss-09', 13, 'boss-09-next-seat-professions-combat'],
    ['base:boss/boss-10', 12, 'boss-10-attacking-party-professions-combat'],
  ] as const)('derives %s combat from the required complete public party across projection, Legal Commands, CPU and Snapshot', (definitionId, requiredCombat, ruleId) => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01', 'base:adventurer/adventurer-01', 'base:starter/adventurer-02']);
    const targetId = replaceTarget(state, 'boss', definitionId);
    state.phase = 'combat'; state.players[0]!.turnCombatBonus = requiredCombat;
    expect(evaluateCombat(state, activeRuleset, 'p1', targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat, appliedRules: [{ ruleId }] } });
    expect(projectPlayerView(state, activeRuleset, 'p1').enemyTargets[targetId]?.effectiveCombat).toBe(requiredCombat);
    expect(getLegalCommands(state, activeRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toMatchObject({ bossProgress: 1 });
    const before = structuredClone(state);
    const rejected = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: 'missing-target' }));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    expect(evaluateCombat(restored, activeRuleset, 'p1', targetId)).toEqual(evaluateCombat(state, activeRuleset, 'p1', targetId));
  });

  it.each([
    ['base:boss/boss-06', 'base:adventurer-deck', 2],
    ['base:boss/boss-09', 'base:item-deck', 1],
  ] as const)('draws the available shared-deck reward for %s without suspending or deadlocking', (definitionId, deckId, count) => {
    const activeRuleset = ruleset();
    const makeState = (suffix: string, available: number) => {
      const state = finishBondSetup(createGame({ gameId: `${definitionId}-${suffix}`, seed: 101, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
      const targetId = replaceTarget(state, 'boss', definitionId); state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
      const deck = state.zones[deckId]!;
      const removed = deck.cardIds.splice(0, Math.max(0, deck.cardIds.length - available));
      state.removedCards.push(...removed);
      return { state, targetId, expected: deck.cardIds.slice(-count).reverse() };
    };
    const normal = makeState('normal', count + 1);
    expect(getLegalCommands(normal.state, activeRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: normal.targetId });
    expect(getCpuActionFeatures(normal.state, activeRuleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === normal.targetId)).toMatchObject({ bossProgress: 1 });
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(normal.state))), activeRuleset);
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', { type: 'ATTACK_TARGET', targetId: normal.targetId }));
    expect(completed.error).toBeUndefined(); expect(completed.state.effectState.pendingChoice).toBeUndefined();
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining(normal.expected));
    expect(completed.events.filter(({ type }) => type === 'SHARED_DECK_CARD_DRAWN')).toHaveLength(count);
    for (const cardId of normal.expected) expect(completed.state.cards[cardId]!.ownerId).toBe('p1');

    const short = makeState('short', Math.max(0, count - 1));
    const partial = dispatch(short.state, activeRuleset, envelope(short.state, 'p1', { type: 'ATTACK_TARGET', targetId: short.targetId }));
    expect(partial.error).toBeUndefined(); expect(partial.state.effectState.pendingChoice).toBeUndefined();
    expect(partial.events.filter(({ type }) => type === 'SHARED_DECK_CARD_DRAWN')).toHaveLength(Math.max(0, count - 1));
    expect(partial.state.players[0]!.turnPurchaseBonus).toBe(5);
  });

  it('grants boss 10 purchase power and three personal draws with discard rebuild and Snapshot parity', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'boss-10-personal-draw', seed: 103, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-10'); state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
    const player = state.players[0]!; player.discardPile.push(...player.hand.splice(0, 3));
    const handBefore = player.hand.length;
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(completed.error).toBeUndefined(); expect(completed.state.effectState.pendingChoice).toBeUndefined();
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(completed.state.players[0]!.hand).toHaveLength(handBefore + 3);
    expect(completed.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(3);
    expect(completed.events.some(({ type }) => type === 'DRAW_PILE_REBUILT')).toBe(true);
  });

  it('resolves boss 02 participant replacement before its reward with Legal Commands, CPU, rollback, shortage, and Snapshot parity', () => {
    const makeState = (gameId: string, emptyDeck = false) => {
      const { state, activeRuleset, selectedIds } = gameWithParty(['base:starter/adventurer-01', 'base:adventurer/adventurer-01']);
      state.gameId = gameId;
      const targetId = replaceTarget(state, 'boss', 'base:boss/boss-02');
      state.phase = 'combat'; state.players[0]!.turnCombatBonus = 6;
      const equipmentIds = ['base:resource/resource-02', 'base:resource/resource-12'].map((definitionId) => Object.values(state.cards).find((card) => card.definitionId === definitionId)!.id);
      for (const cardId of equipmentIds) {
        for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((candidate) => candidate !== cardId);
        for (const candidate of state.players) { candidate.hand = candidate.hand.filter((id) => id !== cardId); candidate.drawPile = candidate.drawPile.filter((id) => id !== cardId); candidate.discardPile = candidate.discardPile.filter((id) => id !== cardId); candidate.playArea = candidate.playArea.filter((id) => id !== cardId); }
        state.cards[cardId]!.ownerId = 'p1';
      }
      state.players[0]!.party[0]!.equipmentId = equipmentIds[0]!; state.players[0]!.party[1]!.equipmentId = equipmentIds[1]!;
      if (emptyDeck) { const deck = state.zones['base:adventurer-deck']!; state.removedCards.push(...deck.cardIds); deck.cardIds = []; }
      return { state, activeRuleset, targetId, starterId: selectedIds[0]!, adventurerId: selectedIds[1]!, normalEquipmentId: equipmentIds[0]!, removalEquipmentId: equipmentIds[1]! };
    };

    const normal = makeState('boss-02-normal');
    expect(getLegalCommands(normal.state, normal.activeRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: normal.targetId });
    expect(getCpuActionFeatures(normal.state, normal.activeRuleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === normal.targetId)).toMatchObject({ bossProgress: 1 });
    const before = structuredClone(normal.state);
    const rejected = dispatch(normal.state, normal.activeRuleset, envelope(normal.state, 'p1', { type: 'ATTACK_TARGET', targetId: 'missing' }));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(normal.state))), normal.activeRuleset);
    const fromSnapshot = dispatch(restored, normal.activeRuleset, envelope(restored, 'p1', { type: 'ATTACK_TARGET', targetId: normal.targetId }, 'boss-02'));
    const direct = dispatch(structuredClone(normal.state), normal.activeRuleset, envelope(normal.state, 'p1', { type: 'ATTACK_TARGET', targetId: normal.targetId }, 'boss-02'));
    expect(fromSnapshot.error).toBeUndefined(); expect(fromSnapshot.state).toEqual(direct.state);
    expect(fromSnapshot.state.removedCards).toContain(normal.starterId);
    expect(fromSnapshot.state.removedCards).not.toContain(normal.adventurerId);
    expect(fromSnapshot.state.players[0]!.party).toHaveLength(0);
    expect(fromSnapshot.state.players[0]!.discardPile).toContain(normal.normalEquipmentId);
    expect(fromSnapshot.state.removedCards).toContain(normal.removalEquipmentId);
    expect(fromSnapshot.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(fromSnapshot.state.enemyTargets[normal.targetId]!.status).toBe('defeated');
    expect(fromSnapshot.events.filter(({ type }) => type === 'SHARED_DECK_CARD_DRAWN')).toHaveLength(4);
    expect(fromSnapshot.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_PARTICIPANTS_SHUFFLED' }));
    expect(fromSnapshot.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_PARTICIPANT_DEPARTURE_APPLIED' }));
    const adventurerLocation = fromSnapshot.state.zones['base:adventurer-deck']!.cardIds.includes(normal.adventurerId) ? 'deck' : fromSnapshot.state.players[0]!.discardPile.includes(normal.adventurerId) ? 'discard' : 'missing';
    expect(adventurerLocation).not.toBe('missing');
    expect(fromSnapshot.state.cards[normal.adventurerId]!.ownerId).toBe(adventurerLocation === 'discard' ? 'p1' : undefined);

    const short = makeState('boss-02-short', true);
    const partial = dispatch(short.state, short.activeRuleset, envelope(short.state, 'p1', { type: 'ATTACK_TARGET', targetId: short.targetId }, 'boss-02-short'));
    expect(partial.error).toBeUndefined(); expect(partial.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(partial.events.filter(({ type }) => type === 'SHARED_DECK_CARD_DRAWN')).toHaveLength(1);
    expect(partial.state.removedCards).toContain(short.starterId);
    expect(partial.state.players[0]!.discardPile).toContain(short.adventurerId);
  });

  it('keeps boss 03 alive after an unpaid post-combat cost without restoring consumed participants', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'boss-03-failed-cost', seed: 107, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-03'); const player = state.players[0]!;
    state.phase = 'combat'; player.turnCombatBonus = 9;
    const handAdventurers = player.hand.filter((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.tags?.some((tag) => tag.startsWith('profession:')));
    player.hand = player.hand.filter((cardId) => !handAdventurers.includes(cardId)); player.discardPile.push(...handAdventurers);
    const participantId = player.party[0]!.adventurerId; const partyBefore = player.party.length;
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toMatchObject({ bossProgress: 0, honorGain: 0 });
    const completed = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId }, 'boss-03-failed'));
    expect(completed.error).toBeUndefined(); expect(completed.state.revision).toBe(state.revision + 1);
    expect(completed.state.enemyTargets[targetId]!.status).toBe('available');
    expect(completed.state.players[0]!.party).toHaveLength(partyBefore - 1);
    expect(completed.state.players[0]!.discardPile).toContain(participantId);
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(0);
    expect(completed.state.effectState.pendingChoice).toBeUndefined();
    expect(completed.events).toContainEqual(expect.objectContaining({ type: 'COMBAT_FAILED', causedByCommandId: 'boss-03-failed', payload: { schemaVersion: 1, kind: 'combat-failure', reasonCode: 'BOSS_03_REQUIRED_HAND_ADVENTURER_MISSING' } }));
    expect(completed.events.some(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toBe(false);
  });

  it('resumes boss 03 mandatory hand cost and optional removals through Snapshot with forged-choice rollback', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'boss-03-success-cost', seed: 109, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-03'); const player = state.players[0]!;
    state.phase = 'combat'; player.turnCombatBonus = 9;
    const deck = state.zones['base:adventurer-deck']!;
    const costIndex = deck.cardIds.findIndex((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.tags?.some((tag) => tag.startsWith('profession:')));
    const [costId] = deck.cardIds.splice(costIndex, 1); player.hand.push(costId!); state.cards[costId!]!.ownerId = player.id;
    const participantId = player.party[0]!.adventurerId;
    const attacked = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId }, 'boss-03-root'));
    expect(attacked.error).toBeUndefined();
    expect(attacked.state.effectState.pendingChoice).toMatchObject({ choiceId: 'base:boss/boss-03-hand-adventurer-cost', decisionKind: 'discard-card', options: [expect.objectContaining({ id: costId })] });
    const pending = attacked.state.effectState.pendingChoice!;
    const forged = dispatch(attacked.state, activeRuleset, envelope(attacked.state, player.id, { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }, 'boss-03-forged'));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state).toEqual(state);

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(attacked.state))), activeRuleset);
    const pay = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === costId)!;
    const paid = dispatch(restored, activeRuleset, envelope(restored, player.id, pay, 'boss-03-pay'));
    expect(paid.error).toBeUndefined(); expect(paid.state.effectState.pendingChoice).toMatchObject({ choiceId: 'base:boss/boss-03-remove-first', decisionKind: 'remove-card' });
    expect(paid.state.players[0]!.discardPile).toEqual(expect.arrayContaining([costId!, participantId]));
    const remove = getLegalCommands(paid.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === participantId)!;
    const removed = dispatch(paid.state, activeRuleset, envelope(paid.state, player.id, remove, 'boss-03-remove'));
    expect(removed.error).toBeUndefined(); expect(removed.state.effectState.pendingChoice).toMatchObject({ choiceId: 'base:boss/boss-03-remove-second' });
    const continuation = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(removed.state))), activeRuleset);
    const skip = getLegalCommands(continuation, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const completed = dispatch(continuation, activeRuleset, envelope(continuation, player.id, skip, 'boss-03-skip'));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5);
    expect(completed.state.removedCards).toContain(participantId);
    expect(completed.state.players[0]!.discardPile).toContain(costId);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(1);
  });

  it.each([
    ['base:boss/boss-08', 3, 5, 4, 'BOSS_08_MAXIMUM_THREE_ADVENTURERS'],
    ['base:boss/boss-11', 1, 5, 4, 'BOSS_11_FIRST_ADVENTURER_ONLY'],
  ] as const)('enforces the leading-party participant limit for %s across projection, Legal Commands and CPU', (definitionId, maximumPartySlots, legalBonus, illegalBonus, reasonCode) => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: `participant-${definitionId}`, seed: 83, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', definitionId); state.phase = 'combat'; state.players[0]!.turnCombatBonus = legalBonus;
    expect(evaluateCombat(state, activeRuleset, 'p1', targetId)).toMatchObject({ status: 'ready', evaluation: { maximumPartySlots, participantLimitReasonCode: reasonCode } });
    expect(projectPlayerView(state, activeRuleset, 'p1').enemyTargets[targetId]).toMatchObject({ maximumPartySlots, participantLimitReasonCode: reasonCode });
    expect(getLegalCommands(state, activeRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toMatchObject({ bossProgress: 1 });
    state.players[0]!.turnCombatBonus = illegalBonus;
    expect(getLegalCommands(state, activeRuleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId });
    const before = structuredClone(state); const rejected = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
  });

  it.each([
    ['base:boss/boss-01', 'base:item-row', 'base:item-deck', 4, ['item', 'equipment']],
    ['base:boss/boss-08', 'base:adventurer-row', 'base:adventurer-deck', 3, ['adventurer']],
    ['base:boss/boss-11', 'base:item-row', 'base:item-deck', 3, ['item']],
  ] as const)('grants the typed two-card public-row reward for %s and skips zero candidates', (definitionId, rowId, deckId, maximumCost, types) => {
    const activeRuleset = ruleset();
    const makeState = (suffix: string) => {
      const state = finishBondSetup(createGame({ gameId: `${definitionId}-${suffix}`, seed: suffix === 'normal' ? 89 : 97, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
      const targetId = replaceTarget(state, 'boss', definitionId); state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
      return { state, targetId };
    };
    const predicate = (definition: (typeof activeRuleset.registry.definitions)[string]) => types.includes(definition.type as never) && (definition.cost ?? Number.POSITIVE_INFINITY) <= maximumCost;
    const normal = makeState('normal'); const selected = arrangePublicRow(normal.state, activeRuleset, rowId, deckId, predicate, true);
    const attacked = dispatch(normal.state, activeRuleset, envelope(normal.state, 'p1', { type: 'ATTACK_TARGET', targetId: normal.targetId }, `${definitionId}:root`));
    expect(attacked.error).toBeUndefined(); expect(attacked.state.effectState.pendingChoice?.decisionKind).toBe('choose-market-card');
    const pending = attacked.state.effectState.pendingChoice!;
    const forged = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }, `${definitionId}:forged`));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state.enemyTargets[normal.targetId]!.status).toBe('available');
    const first = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selected[0])!;
    const afterFirst = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', first, `${definitionId}:first`));
    expect(afterFirst.error).toBeUndefined(); expect(afterFirst.state.effectState.pendingChoice).toBeDefined();
    const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(afterFirst.state)));
    const restored = restoreSnapshot(snapshot, activeRuleset);
    const second = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selected[1])!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', second, `${definitionId}:second`));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5); expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining(selected)); expect(completed.state.enemyTargets[normal.targetId]!.status).toBe('defeated');

    const empty = makeState('empty'); arrangePublicRow(empty.state, activeRuleset, rowId, deckId, predicate, false);
    const skipped = dispatch(empty.state, activeRuleset, envelope(empty.state, 'p1', { type: 'ATTACK_TARGET', targetId: empty.targetId }));
    expect(skipped.error).toBeUndefined(); expect(skipped.state.effectState.pendingChoice).toBeUndefined(); expect(skipped.state.players[0]!.turnPurchaseBonus).toBe(5); expect(skipped.events.some(({ type }) => type === 'EFFECT_CHOICE_SKIPPED')).toBe(true);
  });

  it('applies adventurer 05 equipment discount only to its controller across query, preview, CPU, dispatch and Snapshot', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-05']);
    const row = state.zones['base:item-row']!;
    let equipmentId = row.cardIds.find((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'equipment');
    if (!equipmentId) {
      const deck = state.zones['base:item-deck']!;
      equipmentId = deck.cardIds.find((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'equipment')!;
      const displaced = row.cardIds.pop()!;
      deck.cardIds.splice(deck.cardIds.indexOf(equipmentId), 1, displaced);
      row.cardIds.push(equipmentId);
    }
    state.phase = 'purchase'; state.players[0]!.turnPurchaseBonus = 100; state.players[1]!.turnPurchaseBonus = 100;
    const printedCost = activeRuleset.registry.definitions[state.cards[equipmentId]!.definitionId]!.cost!;
    expect(evaluatePurchaseCost(state, activeRuleset, { schemaVersion: 1, playerId: 'p1', cardId: equipmentId })).toMatchObject({ status: 'ready', evaluation: { printedCost, effectiveCost: printedCost - 1, appliedModifiers: [{ ruleId: 'adventurer-05-equipment-discount', amount: -1 }] } });
    expect(evaluatePurchaseCost(state, activeRuleset, { schemaVersion: 1, playerId: 'p2', cardId: equipmentId })).toMatchObject({ status: 'ready', evaluation: { printedCost, effectiveCost: printedCost, appliedModifiers: [] } });
    expect(getLegalCommands(state, activeRuleset, 'p1')).toContainEqual({ type: 'BUY_CARD', cardId: equipmentId });
    expect(getActionPreviewSet(state, activeRuleset, 'p1').items).toContainEqual(expect.objectContaining({ kind: 'purchase', cardId: equipmentId, effectiveCost: printedCost - 1 }));
    expect(getCpuActionFeatures(state, activeRuleset, 'p1').find(({ command }) => command.type === 'BUY_CARD' && command.cardId === equipmentId)).toMatchObject({ purchaseCost: printedCost - 1 });
    const before = structuredClone(state);
    expect(dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'BUY_CARD', cardId: 'missing' })).state).toEqual(before);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    const purchased = dispatch(restored, activeRuleset, envelope(restored, 'p1', { type: 'BUY_CARD', cardId: equipmentId }));
    expect(purchased.error).toBeUndefined(); expect(purchased.state.players[0]!.turnPurchaseSpent).toBe(printedCost - 1);
  });

  it.each([
    [['base:starter/adventurer-01', 'base:adventurer/adventurer-04'], [3, 2]],
    [['base:adventurer/adventurer-10', 'base:starter/adventurer-01'], [4, 1]],
    [['base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:adventurer/adventurer-15'], [1, 2, 1, 3]],
    [['base:adventurer/adventurer-20', 'base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04'], [1, 1, 2, 1, 1]],
    [['base:starter/adventurer-01', 'base:adventurer/adventurer-27', 'base:starter/adventurer-02'], [2, 1, 3]],
  ] as const)('computes enabled position/party combat for %j', (definitionIds, expectedCombat) => {
    const { state, activeRuleset } = gameWithParty(definitionIds);
    const before = structuredClone(state);
    const result = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1' });
    expect(result.status === 'ready' ? result.evaluation.members.map(({ effectiveCombat }) => effectiveCombat) : result).toEqual(expectedCombat);
    expect(state).toEqual(before);
  });

  it('shares adventurer 24 monster combat across Legal Commands, CPU, dispatch, rollback and Snapshot restore', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-24']);
    const monsterId = replaceTarget(state, 'monster', 'base:monster/monster-09');
    const bossId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!.targetId;
    state.phase = 'combat';
    expect(evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1', targetId: monsterId })).toMatchObject({ status: 'ready', evaluation: { members: [{ effectiveCombat: 4 }] } });
    expect(evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1', targetId: bossId })).toMatchObject({ status: 'ready', evaluation: { members: [{ effectiveCombat: 1 }] } });
    expect(getLegalCommands(state, activeRuleset, 'p1')).toContainEqual({ type: 'ATTACK_TARGET', targetId: monsterId });
    expect(getLegalCommands(state, activeRuleset, 'p1')).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: bossId });
    expect(getCpuActionFeatures(state, activeRuleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === monsterId)).toMatchObject({ partyCombatLoss: 4, monsterDefeat: 1 });
    const before = structuredClone(state);
    const rejected = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: bossId }));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    expect(evaluatePartyCombat(restored, activeRuleset, { schemaVersion: 1, playerId: 'p1', targetId: monsterId })).toEqual(evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1', targetId: monsterId }));
    const attacked = dispatch(restored, activeRuleset, envelope(restored, 'p1', { type: 'ATTACK_TARGET', targetId: monsterId }));
    expect(attacked.error).toBeUndefined(); expect(attacked.state.effectState.pendingChoice).toBeDefined();
    const continuation = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(attacked.state))), activeRuleset);
    const skip = getLegalCommands(continuation, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const completed = dispatch(continuation, activeRuleset, envelope(continuation, 'p1', skip));
    expect(completed.error).toBeUndefined(); expect(completed.state.enemyTargets[monsterId]!.status).toBe('defeated');
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
