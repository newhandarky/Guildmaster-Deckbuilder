import { baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { applyEnemyEntryAttachment, attachTargets, attachedCardIds, baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateAttachment, evaluateBondCondition, evaluateCombat, evaluateCombatPartyPrefix, evaluateEquipmentCombatModifiers, evaluateEquipmentDeparture, evaluateEquipmentEligibility, evaluatePartyCombat, evaluatePurchaseCost, getActionPreviewSet, getCpuActionFeatures, getLegalCommands, getPurchasePower, getScoreboard, projectPlayerView, restoreSnapshot, serializeSnapshot, validateSupplyContinuityState } from '@guildmaster/game-engine';
import { describe, expect, it } from 'vitest';
import { baseProvisionalOriginalFullRulesModule, baseProvisionalOriginalFullZoneIds } from '../src/index.js';

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
  if (withCandidates) expect(arranged).toHaveLength(3);
  else expect(arranged.length).toBeGreaterThan(0);
  row.cardIds = arranged; deck.cardIds = supply.filter((cardId) => !arranged.includes(cardId));
  return selected;
}

describe('full provisional base rules contribution', () => {
  it('uses a new rules module identity for bond timing and non-starter turn-fact semantics', () => {
    expect(baseProvisionalOriginalFullRulesModule.version).toBe('2.11.0');
  });

  it('registers the complete provisional base card-rules set and all 30 bond conditions', () => {
    expect(baseProvisionalOriginalFullRulesModule.config?.enabledDefinitionIds).toEqual(expect.arrayContaining([
      ...['07', '14', '19', '21', '22', '25', '29'].map((id) => `base:adventurer/adventurer-${id}`),
      ...['23', '26'].map((id) => `base:resource/resource-${id}`),
      ...['04', '07'].map((id) => `base:boss/boss-${id}`),
    ]));
    expect(baseProvisionalOriginalFullRulesModule.bondConditionRules?.map(({ bondId }) => bondId)).toEqual(
      Array.from({ length: 30 }, (_, index) => `base:bond/bond-${String(index + 1).padStart(2, '0')}`),
    );
    expect(baseProvisionalOriginalFullRulesModule.lifecycleHooks?.map(({ hookId }) => hookId)).toEqual([
      'adventurer-03-odd-roll-combat-at-combat-start',
      'adventurer-01-recover-after-combat',
      'adventurer-06-draw-resource-after-combat',
      'adventurer-18-purchase-after-combat',
      'adventurer-23-roll-monster-penalty-at-combat-start',
      'adventurer-30-remove-after-combat',
      'resource-19-draw-after-combat',
      'resource-16-discard-enemy-at-combat-start',
      'resource-20-discard-for-combat-at-combat-start',
      'resource-21-purchase-at-purchase-start',
      'adventurer-11-order-deck-on-entry',
      'adventurer-12-move-first-on-entry',
      'adventurer-13-remove-on-entry',
      'adventurer-07-refresh-monsters-on-entry',
      'adventurer-08-penalize-monster-on-entry',
      'adventurer-16-reveal-top-on-entry',
      'adventurer-17-draw-discard-on-entry',
      'adventurer-26-enemy-purchase-on-entry',
      'adventurer-28-draw-on-entry',
      'adventurer-28-draw-on-equip',
      'adventurer-14-discard-when-first',
    ]);
    expect(baseProvisionalOriginalFullRulesModule.combatRewardPolicies?.map(({ rewardPolicyId }) => rewardPolicyId)).toEqual([
      'boss-01-purchase-and-market-cards',
      'boss-02-purchase-and-adventurer-deck',
      'monster-01-purchase-bonus',
      'monster-02-roll-purchase-bonus',
      'monster-03-remove-one',
      'monster-04-recruit-cost-three',
      'monster-05-public-item-draft',
      'monster-06-remove-up-to-two',
      'monster-07-item-cost-three',
      'monster-08-item-cost-four',
      'monster-09-draw-two',
      'monster-10-remove-hand',
      'monster-11-remove-discard',
      'monster-12-recruit-cost-four',
      'monster-13-replace-hand',
      'monster-14-draw-one',
      'boss-03-hand-adventurer-gate-and-reward',
      'boss-04-purchase-and-draw-four',
      'boss-05-purchase-and-market-cards',
      'boss-06-purchase-and-adventurer-deck',
      'boss-07-purchase-and-adventurer-deck',
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
    expect(baseProvisionalOriginalFullRulesModule.combatDepartureReplacementPolicies).toEqual([
      expect.objectContaining({ policyId: 'adventurer-19-attachment-substitute', replacement: { kind: 'discard-attached-card', attachmentDefinitionTypes: ['monster', 'boss'] } }),
      expect.objectContaining({ policyId: 'adventurer-21-return-to-draw-top', replacement: { kind: 'self-to-player-draw-top' } }),
    ]);
    expect(baseProvisionalOriginalFullRulesModule.diceDefinitions).toEqual([{
      schemaVersion: 1,
      moduleId: 'base:provisional-original-full-rules',
      diceId: 'monster-02-reward-d6',
      sides: 6,
    }, {
      schemaVersion: 1,
      moduleId: 'base:provisional-original-full-rules',
      diceId: 'adventurer-03-combat-d6',
      sides: 6,
    }, {
      schemaVersion: 1,
      moduleId: 'base:provisional-original-full-rules',
      diceId: 'adventurer-23-combat-d6',
      sides: 6,
    }]);
    expect(baseProvisionalOriginalFullRulesModule.equipmentCombatModifierRules).toEqual([
      expect.objectContaining({ ruleId: 'adventurer-09-equipped-bonus', amount: 1, when: expect.objectContaining({ kind: 'adventurer-definition-in' }) }),
      expect.objectContaining({ ruleId: 'resource-02-melee-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-03-support-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-07-ranged-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-09-boss-bonus', amount: 2, when: expect.objectContaining({ kind: 'all' }) }),
      expect.objectContaining({ ruleId: 'resource-25-tank-bonus', amount: 1, when: expect.objectContaining({ kind: 'all' }) }),
    ]);
    expect(baseProvisionalOriginalFullRulesModule.equipmentEligibilityRules).toEqual([
      expect.objectContaining({ ruleId: 'adventurer-02-no-equipment' }),
      expect.objectContaining({ ruleId: 'resource-14-melee-or-support-only' }),
      expect.objectContaining({ ruleId: 'resource-19-mage-or-support-only' }),
      expect.objectContaining({ ruleId: 'resource-16-tank-or-melee-only' }),
    ]);
    expect(baseProvisionalOriginalFullRulesModule.partyCombatModifierRules?.map(({ ruleId }) => ruleId)).toEqual([
      'adventurer-04-first-other-bonus', 'adventurer-14-other-party-bonus', 'adventurer-10-first-self-bonus', 'adventurer-15-rear-self-bonus',
      'adventurer-20-party-size-penalty', 'adventurer-24-monster-self-bonus', 'adventurer-27-adjacent-bonus', 'resource-11-other-party-bonus',
    ]);
    expect(baseProvisionalOriginalFullRulesModule.purchaseCostModifierRules).toEqual([expect.objectContaining({ ruleId: 'adventurer-05-equipment-discount', amount: -1, activation: { kind: 'definition-in-player-party', player: 'evaluated-player', definitionId: 'base:adventurer/adventurer-05' } })]);
    expect(baseProvisionalOriginalFullRulesModule.equipmentDeparturePolicies).toEqual([
      expect.objectContaining({ policyId: 'resource-12-combat-removal', cause: 'combat-discard', disposition: 'remove-from-game', reasonCode: 'RESOURCE_12_WEARER_COMBAT_DISCARD_REMOVES_EQUIPMENT' }),
      expect.objectContaining({ policyId: 'resource-14-combat-removal', cause: 'combat-discard', disposition: 'remove-from-game', reasonCode: 'RESOURCE_14_WEARER_COMBAT_DISCARD_REMOVES_EQUIPMENT' }),
      expect.objectContaining({ policyId: 'resource-24-combat-draw', cause: 'combat-discard', disposition: 'discard', rewards: [{ kind: 'draw', count: 2 }], reasonCode: 'RESOURCE_24_WEARER_COMBAT_DISCARD_DRAWS_TWO' }),
    ]);
    expect(baseProvisionalOriginalFullRulesModule.discardRedirectPolicies).toEqual([expect.objectContaining({ policyId: 'resource-06-right-seat-discard', destination: 'right-seat-discard', definitionIds: ['base:resource/resource-06'] })]);
    expect(JSON.parse(JSON.stringify(baseProvisionalOriginalFullRulesModule.config))).toEqual(baseProvisionalOriginalFullRulesModule.config);
  });

  it.each(Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, '0')))(
    'evaluates the printed boundary for bond %s through the authoritative ledger and Snapshot',
    (suffix) => {
      const parties: Record<string, readonly string[]> = {
        '01': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-13', 'base:adventurer/adventurer-11'],
        '03': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-11', 'base:adventurer/adventurer-19'],
        '04': ['base:adventurer/adventurer-01'],
        '07': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-07', 'base:adventurer/adventurer-15'],
        '09': ['base:adventurer/adventurer-04', 'base:adventurer/adventurer-02', 'base:adventurer/adventurer-09'],
        '10': ['base:adventurer/adventurer-02', 'base:adventurer/adventurer-06', 'base:adventurer/adventurer-01'],
        '11': ['base:adventurer/adventurer-11', 'base:adventurer/adventurer-19'],
        '12': ['base:adventurer/adventurer-04', 'base:adventurer/adventurer-09'],
        '14': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-02', 'base:adventurer/adventurer-04', 'base:adventurer/adventurer-07', 'base:adventurer/adventurer-11'],
        '15': ['base:adventurer/adventurer-07', 'base:adventurer/adventurer-15'],
        '19': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-13'],
        '20': ['base:adventurer/adventurer-02', 'base:adventurer/adventurer-06'],
        '21': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-13', 'base:adventurer/adventurer-17'],
        '22': ['base:adventurer/adventurer-04', 'base:adventurer/adventurer-09'],
        '28': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-13'],
        '29': ['base:adventurer/adventurer-11', 'base:adventurer/adventurer-01', 'base:adventurer/adventurer-13'],
        '30': ['base:adventurer/adventurer-01', 'base:adventurer/adventurer-02', 'base:adventurer/adventurer-11'],
      };
      const { state, activeRuleset } = gameWithParty(parties[suffix] ?? ['base:adventurer/adventurer-01']);
      state.phase = 'combat';
      Object.assign(state.turnFacts!, {
        adventurersRecruited: 10,
        adventurersAddedToParty: 10,
        nonStarterAdventurersAddedToParty: 10,
        itemsBought: 10,
        equipmentBought: 10,
        purchasePowerSpent: 10,
        extraCardsDrawn: 10,
        itemsUsed: 10,
        bossesDefeated: 1,
        monstersDefeated: 2,
        actionPhaseItemsUsed: 3,
        lastCombatParticipantCount: suffix === '02' ? 1 : 10,
        lastCombatDiscardedEquipment: 3,
        lastCombatDiscardedNonStarterProfessions: ['profession:support', 'profession:mage', 'profession:melee'],
        monstersUsedForPurchase: 3,
      });
      const bondId = `base:bond/bond-${suffix}`;
      expect(evaluateBondCondition(state, activeRuleset, 'p1', bondId)).toMatchObject({ status: 'ready', evaluation: { satisfied: true, appliedRules: [{ ruleId: `bond-${suffix}-condition` }] } });
      const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
      expect(evaluateBondCondition(restored, activeRuleset, 'p1', bondId)).toEqual(evaluateBondCondition(state, activeRuleset, 'p1', bondId));
    },
  );

  it('counts only non-starter party entries for bond 08 across dispatch and Snapshot', () => {
    const prepare = () => {
      const { state, activeRuleset } = gameWithParty([]);
      const player = state.players[0]!;
      player.bonds = [{ bondId: 'base:bond/bond-08', completed: false }];
      state.phase = 'action1';
      const starterId = player.discardPile.find((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'starter')!;
      player.discardPile.splice(player.discardPile.indexOf(starterId), 1);
      const nonStarterIds = Object.values(state.zones).flatMap(({ cardIds }) => cardIds).filter((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'adventurer').slice(0, 3);
      for (const cardId of [starterId, ...nonStarterIds]) {
        for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((candidate) => candidate !== cardId);
        state.cards[cardId]!.ownerId = player.id;
        player.hand.push(cardId);
      }
      return { state, activeRuleset, starterId, nonStarterIds };
    };
    const play = (initial: ReturnType<typeof prepare>['state'], activeRuleset: ReturnType<typeof ruleset>, cardIds: readonly string[]) => cardIds.reduce((current, cardId, index) => {
      const result = dispatch(current, activeRuleset, envelope(current, 'p1', { type: 'PLAY_ADVENTURER', cardId }, `bond-08-play-${index}`));
      if (result.error) throw new Error(result.error.message);
      return result.state;
    }, initial);

    const mixed = prepare();
    const mixedState = play(mixed.state, mixed.activeRuleset, [mixed.starterId, ...mixed.nonStarterIds.slice(0, 2)]);
    expect(mixedState.turnFacts).toMatchObject({ adventurersAddedToParty: 3, nonStarterAdventurersAddedToParty: 2 });
    expect(evaluateBondCondition(mixedState, mixed.activeRuleset, 'p1', 'base:bond/bond-08')).toMatchObject({ status: 'ready', evaluation: { satisfied: false } });

    const nonStarter = prepare();
    const eligibleState = play(nonStarter.state, nonStarter.activeRuleset, nonStarter.nonStarterIds);
    expect(eligibleState.turnFacts).toMatchObject({ adventurersAddedToParty: 3, nonStarterAdventurersAddedToParty: 3 });
    expect(evaluateBondCondition(eligibleState, nonStarter.activeRuleset, 'p1', 'base:bond/bond-08')).toMatchObject({ status: 'ready', evaluation: { satisfied: true } });
    const restored = restoreSnapshot(serializeSnapshot(eligibleState), nonStarter.activeRuleset);
    expect(evaluateBondCondition(restored, nonStarter.activeRuleset, 'p1', 'base:bond/bond-08')).toEqual(evaluateBondCondition(eligibleState, nonStarter.activeRuleset, 'p1', 'base:bond/bond-08'));
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

  it('draws two when resource 24 follows its wearer to the discard pile after combat', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-14'); const player = state.players[0]!; const slot = player.party[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-24')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== equipmentId);
    const drawIds = state.players[1]!.hand.splice(0, 2); for (const cardId of drawIds) state.cards[cardId]!.ownerId = player.id;
    player.drawPile.push(...drawIds); slot.equipmentId = equipmentId; state.cards[equipmentId]!.ownerId = player.id; player.turnCombatBonus = 4;
    const input = { schemaVersion: 1 as const, playerId: player.id, adventurerId: slot.adventurerId, equipmentCardId: equipmentId, cause: 'combat-discard' as const };
    expect(evaluateEquipmentDeparture(state, activeRuleset, input)).toMatchObject({ status: 'ready', evaluation: { disposition: 'discard', rewards: [{ kind: 'draw', count: 2 }], appliedPolicy: { policyId: 'resource-24-combat-draw' } } });
    const attacked = dispatch(restoreSnapshot(serializeSnapshot(state), activeRuleset), activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId }, 'resource-24-attack'));
    expect(attacked.error).toBeUndefined(); expect(attacked.state.players[0]!.discardPile).toContain(equipmentId); expect(attacked.state.players[0]!.hand).toEqual(expect.arrayContaining(drawIds));
    expect(attacked.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(2); expect(attacked.events.some(({ type }) => type === 'EQUIPMENT_DEPARTURE_REWARD_GRANTED')).toBe(true);
  });

  it('redirects resource 06 acquisition and later rest discard to the right-seat player without leaking a base card ID into Engine', () => {
    const activeRuleset = ruleset(); const initial = finishBondSetup(createGame({ gameId: 'resource-06-redirect', seed: 211, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }, { id: 'p3', name: 'P3', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const cardIds = Object.values(initial.cards).filter(({ definitionId }) => definitionId === 'base:resource/resource-06').map(({ id }) => id); expect(cardIds.length).toBeGreaterThanOrEqual(2);
    const purchase = structuredClone(initial); const itemRow = purchase.zones['base:item-row']!; const itemDeck = purchase.zones['base:item-deck']!; const boughtId = cardIds[0]!;
    for (const zone of Object.values(purchase.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== boughtId);
    for (const candidate of purchase.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((id) => id !== boughtId);
    const displaced = itemRow.cardIds.pop()!; itemDeck.cardIds.push(displaced); itemRow.cardIds.push(boughtId); purchase.phase = 'purchase'; purchase.players[0]!.turnPurchaseBonus = 10;
    expect(getLegalCommands(purchase, activeRuleset, 'p1')).toContainEqual({ type: 'BUY_CARD', cardId: boughtId });
    const acquired = dispatch(restoreSnapshot(serializeSnapshot(purchase), activeRuleset), activeRuleset, envelope(purchase, 'p1', { type: 'BUY_CARD', cardId: boughtId }, 'resource-06-buy'));
    expect(acquired.error).toBeUndefined(); expect(acquired.state.players[0]!.discardPile).not.toContain(boughtId); expect(acquired.state.players[2]!.discardPile).toContain(boughtId); expect(acquired.state.cards[boughtId]!.ownerId).toBe('p3');

    const rest = structuredClone(initial); const heldId = cardIds[1]!; for (const zone of Object.values(rest.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== heldId);
    for (const candidate of rest.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((id) => id !== heldId);
    rest.players[0]!.hand.push(heldId); rest.cards[heldId]!.ownerId = 'p1'; rest.phase = 'rest';
    const settled = dispatch(rest, activeRuleset, envelope(rest, 'p1', { type: 'END_PHASE', phase: 'rest' }, 'resource-06-rest'));
    expect(settled.error).toBeUndefined(); expect(settled.state.players[2]!.discardPile).toContain(heldId); expect(settled.state.cards[heldId]!.ownerId).toBe('p3');
  });

  it('recovers an adventurer through the adventurer 01 combat-end lifecycle across Snapshot and typed CPU choice', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-01']);
    const player = state.players[0]!;
    const recoveredId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-08')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== recoveredId);
    for (const candidate of state.players) {
      candidate.hand = candidate.hand.filter((cardId) => cardId !== recoveredId);
      candidate.drawPile = candidate.drawPile.filter((cardId) => cardId !== recoveredId);
      candidate.discardPile = candidate.discardPile.filter((cardId) => cardId !== recoveredId);
      candidate.playArea = candidate.playArea.filter((cardId) => cardId !== recoveredId);
    }
    player.discardPile.push(recoveredId); state.cards[recoveredId]!.ownerId = player.id;
    state.phase = 'combat'; state.turnFacts!.monstersDefeated = 1; state.turnFacts!.combatResolved = true;
    const suspended = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'combat' }, 'adventurer-01-phase-end'));
    expect(suspended.error).toBeUndefined();
    expect(suspended.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'recover-card', actorId: player.id });
    expect(projectPlayerView(suspended.state, activeRuleset, player.id).decisionPrompt).toMatchObject({ decisionKind: 'recover-card' });
    expect(getCpuActionFeatures(suspended.state, activeRuleset, player.id).some(({ command }) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === recoveredId)).toBe(true);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), activeRuleset);
    const recover = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === recoveredId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, recover, 'adventurer-01-recover'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.hand).toContain(recoveredId);
    expect(completed.state.phase).toBe('action2');
    expect(restoreSnapshot(serializeSnapshot(completed.state), activeRuleset)).toEqual(completed.state);
  });

  it('applies mandatory adventurer 06 and 18 combat-end effects only when the source remains and an enemy was defeated', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-06', 'base:adventurer/adventurer-18']);
    const player = state.players[0]!; const itemDeckBefore = state.zones['base:item-deck']!.cardIds.length; const discardBefore = player.discardPile.length;
    state.phase = 'combat'; state.turnFacts!.bossesDefeated = 1; state.turnFacts!.combatResolved = true;
    const completed = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'combat' }, 'adventurer-06-18-phase-end'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.phase).toBe('action2');
    expect(completed.state.zones['base:item-deck']!.cardIds).toHaveLength(itemDeckBefore - 1);
    expect(completed.state.players[0]!.discardPile).toHaveLength(discardBefore + 1);
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(2);

    const inactive = structuredClone(state); inactive.revision = 0; inactive.eventLogCursor = 0; inactive.turnFacts!.bossesDefeated = 0; inactive.turnFacts!.combatResolved = false;
    const noDefeat = dispatch(inactive, activeRuleset, envelope(inactive, player.id, { type: 'END_PHASE', phase: 'combat' }, 'adventurer-no-defeat'));
    expect(noDefeat.error).toBeUndefined();
    expect(noDefeat.state.players[0]!.turnPurchaseBonus).toBe(0);
  });

  it('applies resource 19 draw and resource 21 purchase bonus from attached source cards at their exact boundaries', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-11', 'base:adventurer/adventurer-06']);
    const player = state.players[0]!;
    const resource19 = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-19')!.id;
    const resource21 = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-21')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== resource19 && cardId !== resource21);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== resource19 && cardId !== resource21);
    player.party[0]!.equipmentId = resource19; player.party[1]!.equipmentId = resource21;
    state.cards[resource19]!.ownerId = player.id; state.cards[resource21]!.ownerId = player.id;
    const drawBefore = player.hand.length;
    state.phase = 'combat'; state.turnFacts!.monstersDefeated = 1; state.turnFacts!.combatResolved = true;
    const afterCombat = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'combat' }, 'resource-19-phase-end'));
    expect(afterCombat.error).toBeUndefined(); expect(afterCombat.state.players[0]!.hand).toHaveLength(drawBefore + 2);
    const toPurchase = structuredClone(afterCombat.state); toPurchase.phase = 'action2';
    const purchase = dispatch(toPurchase, activeRuleset, envelope(toPurchase, player.id, { type: 'END_PHASE', phase: 'action2' }, 'resource-21-phase-start'));
    expect(purchase.error).toBeUndefined(); expect(purchase.state.phase).toBe('purchase'); expect(purchase.state.players[0]!.turnPurchaseBonus).toBe(2);
  });

  it('lets resource 16 discard an enemy at combat start for its printed purchase power and enforces its profession restriction', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-04', 'base:starter/adventurer-05']);
    const player = state.players[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-16')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== equipmentId);
    player.hand.push(equipmentId); state.cards[equipmentId]!.ownerId = player.id; state.phase = 'action1';
    const tankId = player.party[0]!.adventurerId; const rangedId = player.party[1]!.adventurerId;
    expect(evaluateEquipmentEligibility(state, activeRuleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: equipmentId, adventurerId: tankId })).toMatchObject({ status: 'ready', evaluation: { eligible: true } });
    expect(evaluateEquipmentEligibility(state, activeRuleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: equipmentId, adventurerId: rangedId })).toMatchObject({ status: 'ready', evaluation: { eligible: false, rejectionReasonCodes: ['RESOURCE_16_REQUIRES_TANK_OR_MELEE'] } });
    const equipped = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId: tankId }, 'resource-16-equip'));
    expect(equipped.error).toBeUndefined();
    const enemySource = Object.values(equipped.state.cards).find(({ definitionId }) => definitionId === 'base:monster/monster-06')!;
    const enemyId = 'fixture-resource16-enemy';
    equipped.state.cards[enemyId] = { ...structuredClone(enemySource), id: enemyId, ownerId: player.id };
    equipped.state.players[0]!.hand.push(enemyId);
    const bonus = activeRuleset.registry.definitions[enemySource.definitionId]!.purchasePower!;
    const combat = dispatch(equipped.state, activeRuleset, envelope(equipped.state, player.id, { type: 'END_PHASE', phase: 'action1' }, 'resource-16-combat'));
    expect(combat.error).toBeUndefined(); expect(combat.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'discard-card' });
    const restored = restoreSnapshot(serializeSnapshot(combat.state), activeRuleset);
    const choice = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === enemyId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, choice, 'resource-16-discard'));
    expect(completed.error).toBeUndefined(); expect(completed.state.phase).toBe('combat');
    expect(completed.state.players[0]!.discardPile).toContain(enemyId);
    expect(completed.state.players[0]!.turnCombatBonus).toBe(bonus);
  });

  it('lets resource 20 discard any number of hand cards one at a time and commits the combat bonus only after stop', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-20')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== equipmentId);
    player.party[0]!.equipmentId = equipmentId; state.cards[equipmentId]!.ownerId = player.id; state.phase = 'action1';
    const discardIds = player.hand.slice(0, 2); expect(discardIds).toHaveLength(2);
    const combat = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'action1' }, 'resource-20-combat'));
    expect(combat.error).toBeUndefined(); expect(combat.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'discard-card' }); expect(combat.state.revision).toBe(state.revision);
    const first = getLegalCommands(combat.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === discardIds[0])!;
    const once = dispatch(combat.state, activeRuleset, envelope(combat.state, player.id, first, 'resource-20-first'));
    expect(once.error).toBeUndefined(); expect(once.state.players[0]!.turnCombatBonus).toBe(1); expect(once.state.effectState.pendingChoice).toBeDefined(); expect(once.state.revision).toBe(state.revision);
    const restored = restoreSnapshot(serializeSnapshot(once.state), activeRuleset);
    const second = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === discardIds[1])!;
    const twice = dispatch(restored, activeRuleset, envelope(restored, player.id, second, 'resource-20-second'));
    expect(twice.error).toBeUndefined(); expect(twice.state.players[0]!.turnCombatBonus).toBe(2);
    const stop = getLegalCommands(twice.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':stop'))!;
    const completed = dispatch(twice.state, activeRuleset, envelope(twice.state, player.id, stop, 'resource-20-stop'));
    expect(completed.error).toBeUndefined(); expect(completed.state.phase).toBe('combat'); expect(completed.state.revision).toBe(state.revision + 1);
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining(discardIds));
  });

  it('reveals and takes only an item or equipment from the deck top for adventurer 16 entry', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-16')!.id;
    const itemId = state.zones['base:item-deck']!.cardIds.find((cardId) => ['item', 'equipment'].includes(activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type))!;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId && cardId !== itemId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== adventurerId && cardId !== itemId);
    player.hand.push(adventurerId); player.drawPile.push(itemId); state.cards[adventurerId]!.ownerId = player.id; state.cards[itemId]!.ownerId = player.id; state.phase = 'action1';
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: adventurerId }, 'adventurer-16-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.players[0]!.hand).toContain(itemId); expect(entered.state.players[0]!.drawPile).not.toContain(itemId);
    expect(entered.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'CARD_REVEALED' }), expect.objectContaining({ type: 'CARD_DRAWN' })]));
    expect(restoreSnapshot(serializeSnapshot(entered.state), activeRuleset)).toEqual(entered.state);
  });

  it('lets adventurer 07 refresh any monster subset left-to-right through Snapshot and typed Legal Commands', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']);
    const player = state.players[0]!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-07')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== adventurerId);
    player.hand.push(adventurerId); state.cards[adventurerId]!.ownerId = player.id; state.phase = 'action1';
    const beforeRow = [...state.zones['base:monster-row']!.cardIds];
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: adventurerId }, 'adventurer-07-enter'));
    expect(entered.error).toBeUndefined();
    expect(entered.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-enemy-target', source: { kind: 'shared-zone', zoneId: 'base:monster-row' } });
    expect(getLegalCommands(entered.state, activeRuleset, player.id).filter(({ type }) => type === 'RESOLVE_EFFECT_CHOICE')).toHaveLength(8);
    const restored = restoreSnapshot(serializeSnapshot(entered.state), activeRuleset);
    const refresh = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'refresh-5')!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, refresh, 'adventurer-07-refresh'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.zones['base:monster-row']!.cardIds).toHaveLength(3);
    expect(completed.state.zones['base:monster-row']!.cardIds).not.toContain(beforeRow[0]);
    expect(completed.state.zones['base:monster-row']!.cardIds).toContain(beforeRow[1]);
    expect(completed.state.zones['base:monster-row']!.cardIds).not.toContain(beforeRow[2]);
    expect(completed.state.zones['base:monster-deck']!.cardIds.slice(0, 2)).toEqual([beforeRow[2], beforeRow[0]]);
    expect(Object.values(completed.state.enemyTargets).filter(({ status }) => status === 'available')).toHaveLength(4);
  });

  it('lets adventurer 11 privately remove at most one of the top three and reorder the rest through Snapshot and CPU legal commands', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-11')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== sourceId);
    const deckCards = state.players[1]!.hand.splice(0, 3); for (const cardId of deckCards) state.cards[cardId]!.ownerId = player.id;
    player.hand.push(sourceId); player.drawPile.push(...deckCards); state.cards[sourceId]!.ownerId = player.id; state.phase = 'action1';
    const inspected = player.drawPile.slice(-3);
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-11-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-order', order: { cardIds: inspected, mayRemove: true } });
    const restored = restoreSnapshot(serializeSnapshot(entered.state), activeRuleset);
    const commands = getLegalCommands(restored, activeRuleset, player.id).filter((command) => command.type === 'RESOLVE_EFFECT_ORDER');
    expect(commands).toHaveLength(12); expect(getCpuActionFeatures(restored, activeRuleset, player.id).some(({ command }) => command.type === 'RESOLVE_EFFECT_ORDER')).toBe(true);
    const remove = commands.find((command) => command.type === 'RESOLVE_EFFECT_ORDER' && command.removeCardId === inspected[0])!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, remove, 'adventurer-11-order'));
    expect(completed.error).toBeUndefined(); expect(completed.state.removedCards).toContain(inspected[0]); expect(completed.state.revision).toBe(state.revision + 1);
    expect(completed.state.effectState.pendingChoice).toBeUndefined();
  });

  it('adds one purchase power per monster or boss in hand only for adventurer 26 entry turn', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-26')!.id;
    const enemyIds = ['base:monster/monster-06', 'base:boss/boss-01'].map((definitionId) => Object.values(state.cards).find((card) => card.definitionId === definitionId)!.id);
    for (const id of [sourceId, ...enemyIds]) { for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== id); for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== id); state.cards[id]!.ownerId = player.id; }
    player.hand.push(sourceId, ...enemyIds); state.phase = 'action1'; const before = getPurchasePower(state, activeRuleset, player.id);
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-26-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.turnFacts?.enemyCardPurchaseBonusPerCard).toBe(1); expect(getPurchasePower(entered.state, activeRuleset, player.id)).toBe(before + 2);
    expect(restoreSnapshot(serializeSnapshot(entered.state), activeRuleset)).toEqual(entered.state);
    const nextTurn = structuredClone(entered.state); nextTurn.phase = 'rest'; const ended = dispatch(nextTurn, activeRuleset, envelope(nextTurn, player.id, { type: 'END_PHASE', phase: 'rest' }, 'adventurer-26-turn-end'));
    expect(ended.error).toBeUndefined(); expect(ended.state.turnFacts?.enemyCardPurchaseBonusPerCard ?? 0).toBe(0);
  });

  it('applies adventurer 08 entry penalty to the selected monster and expires it at turn end', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-08')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== adventurerId);
    player.hand.push(adventurerId); state.cards[adventurerId]!.ownerId = player.id; state.phase = 'action1';
    const target = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    const before = evaluateCombat(state, activeRuleset, player.id, target.targetId);
    if (before.status !== 'ready') throw new Error(before.error);
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: adventurerId }, 'adventurer-08-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-enemy-target' });
    const choice = getLegalCommands(entered.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === target.cardInstanceId)!;
    const completed = dispatch(restoreSnapshot(serializeSnapshot(entered.state), activeRuleset), activeRuleset, envelope(entered.state, player.id, choice, 'adventurer-08-target'));
    expect(completed.error).toBeUndefined();
    expect(evaluateCombat(completed.state, activeRuleset, player.id, target.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: before.evaluation.requiredCombat - 2 } });
    expect(completed.state.temporaryTargetModifiers).toHaveLength(1);
    completed.state.phase = 'rest';
    const ended = dispatch(completed.state, activeRuleset, envelope(completed.state, player.id, { type: 'END_PHASE', phase: 'rest' }, 'adventurer-08-expire'));
    expect(ended.error).toBeUndefined(); expect(ended.state.temporaryTargetModifiers).toEqual([]);
    expect(evaluateCombat(ended.state, activeRuleset, ended.state.activePlayerId, target.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: before.evaluation.requiredCombat } });
  });

  it('rolls adventurer 23 at combat start and applies half the face rounded up to one selected monster', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-23']); const player = state.players[0]!;
    state.phase = 'action1';
    const target = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    const before = evaluateCombat(state, activeRuleset, player.id, target.targetId);
    if (before.status !== 'ready') throw new Error(before.error);
    const combat = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'action1' }, 'adventurer-23-combat'));
    expect(combat.error).toBeUndefined(); expect(combat.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-enemy-target' });
    const roll = combat.events.find(({ type }) => type === 'DIE_ROLLED');
    const face = Number((roll?.payload as { evaluation?: { face?: number } } | undefined)?.evaluation?.face);
    expect(face).toBeGreaterThanOrEqual(1); expect(face).toBeLessThanOrEqual(6);
    const restored = restoreSnapshot(serializeSnapshot(combat.state), activeRuleset);
    const choice = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === target.cardInstanceId)!;
    expect(getCpuActionFeatures(restored, activeRuleset, player.id)).toEqual(expect.arrayContaining([expect.objectContaining({ command: choice })]));
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, choice, 'adventurer-23-target'));
    expect(completed.error).toBeUndefined(); expect(completed.state.phase).toBe('combat');
    expect(evaluateCombat(completed.state, activeRuleset, player.id, target.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: before.evaluation.requiredCombat - Math.ceil(face / 2) } });
  });

  it('rolls adventurer 03 at combat start and adds exactly one combat only on odd faces', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-03']); const player = state.players[0]!;
    state.phase = 'action1';
    const before = structuredClone(state);
    const rejected = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'combat' }, 'adventurer-03-forged'));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);

    const combat = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'END_PHASE', phase: 'action1' }, 'adventurer-03-combat'));
    expect(combat.error).toBeUndefined(); expect(combat.state.phase).toBe('combat'); expect(combat.state.effectState.pendingChoice).toBeUndefined();
    const roll = combat.events.find((event) => event.type === 'DIE_ROLLED' && JSON.stringify(event.payload).includes('adventurer-03-combat-d6'));
    const face = Number((roll?.payload as { evaluation?: { face?: number } } | undefined)?.evaluation?.face);
    expect(face).toBeGreaterThanOrEqual(1); expect(face).toBeLessThanOrEqual(6);
    expect(combat.state.players[0]!.turnCombatBonus).toBe(0);
    expect(evaluatePartyCombat(combat.state, activeRuleset, { schemaVersion: 1, playerId: player.id })).toMatchObject({
      status: 'ready', evaluation: { members: [{ effectiveCombat: 3 + (face % 2 === 1 ? 1 : 0) }] },
    });
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(combat.state))), activeRuleset);
    expect(restored.turnFacts?.partyCombatBonuses).toEqual(combat.state.turnFacts?.partyCombatBonuses);
    expect(() => getCpuActionFeatures(restored, activeRuleset, player.id)).not.toThrow();
  });

  it('does not count adventurer 03 turn combat bonus while it is outside the committed party prefix', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01', 'base:adventurer/adventurer-03']);
    const player = state.players[0]!;
    state.phase = 'combat';
    state.turnFacts!.partyCombatBonuses = [{ definitionId: 'base:adventurer/adventurer-03', amount: 1 }];
    const party = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: player.id });
    if (party.status !== 'ready') throw new Error(party.error);
    const firstMemberCombat = party.evaluation.members[0]!.effectiveCombat;
    expect(evaluateCombatPartyPrefix(state, activeRuleset, player.id, firstMemberCombat)).toMatchObject({
      slotCount: 1,
      power: firstMemberCombat,
      participantCardIds: [player.party[0]!.adventurerId],
    });
  });

  it('applies resource 11 plus one to every other party member through Legal Commands, CPU, rollback, and Snapshot', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03']);
    const player = state.players[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-11')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== equipmentId);
    player.party[1]!.equipmentId = equipmentId; state.cards[equipmentId]!.ownerId = player.id; state.phase = 'combat'; player.turnCombatBonus = 100;

    const evaluation = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: player.id });
    expect(evaluation).toMatchObject({ status: 'ready', evaluation: { members: [
      { modifierCombat: 1, appliedRules: [expect.objectContaining({ ruleId: 'resource-11-other-party-bonus', sourceCardId: equipmentId, amount: 1 })] },
      { equipmentId, equipmentCombat: 2, modifierCombat: 0 },
      { modifierCombat: 1, appliedRules: [expect.objectContaining({ sourceCardId: equipmentId })] },
    ] } });
    const targetId = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!.targetId;
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'ATTACK_TARGET', targetId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).some(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === targetId)).toBe(true);
    const restored = restoreSnapshot(serializeSnapshot(state), activeRuleset);
    expect(evaluatePartyCombat(restored, activeRuleset, { schemaVersion: 1, playerId: player.id })).toEqual(evaluation);
    const before = structuredClone(restored);
    const rejected = dispatch(restored, activeRuleset, envelope(restored, player.id, { type: 'ATTACK_TARGET', targetId: 'missing-target' }, 'resource-11-forged'));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
  });

  it('uses resource 22 to reduce one public monster by exactly one until turn end with resumable authoritative choice', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-22')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== itemId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== itemId);
    player.hand.push(itemId); state.cards[itemId]!.ownerId = player.id; state.phase = 'action1';
    const monsters = Object.values(state.enemyTargets).filter(({ kind, status }) => kind === 'monster' && status === 'available');
    const target = monsters[0]!; const other = monsters[1]!;
    const before = evaluateCombat(state, activeRuleset, player.id, target.targetId);
    const otherBefore = evaluateCombat(state, activeRuleset, player.id, other.targetId);
    if (before.status !== 'ready' || otherBefore.status !== 'ready') throw new Error('Monster fixture is not combat-ready.');
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).some(({ command }) => command.type === 'USE_ITEM' && command.cardId === itemId)).toBe(true);

    const used = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-22-use'));
    expect(used.error).toBeUndefined(); expect(used.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-enemy-target' });
    const pending = used.state.effectState.pendingChoice!;
    const forged = dispatch(used.state, activeRuleset, envelope(used.state, player.id, { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }, 'resource-22-forged'));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state).toEqual(used.state);

    const restored = restoreSnapshot(serializeSnapshot(used.state), activeRuleset);
    const choices = getLegalCommands(restored, activeRuleset, player.id).filter((command) => command.type === 'RESOLVE_EFFECT_CHOICE');
    expect(choices.map((command) => command.type === 'RESOLVE_EFFECT_CHOICE' ? command.optionId : '')).toEqual(state.zones['base:monster-row']!.cardIds);
    expect(getCpuActionFeatures(restored, activeRuleset, player.id).some(({ command }) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === target.cardInstanceId)).toBe(true);
    const choice = choices.find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === target.cardInstanceId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, choice, 'resource-22-target'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.playArea).toContain(itemId);
    expect(completed.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'TEMPORARY_TARGET_MODIFIER_ADDED' })]));
    expect(evaluateCombat(completed.state, activeRuleset, player.id, target.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: before.evaluation.requiredCombat - 1 } });
    expect(evaluateCombat(completed.state, activeRuleset, player.id, other.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: otherBefore.evaluation.requiredCombat } });
    expect(restoreSnapshot(serializeSnapshot(completed.state), activeRuleset)).toEqual(completed.state);
    completed.state.phase = 'rest';
    const ended = dispatch(completed.state, activeRuleset, envelope(completed.state, player.id, { type: 'END_PHASE', phase: 'rest' }, 'resource-22-expire'));
    expect(ended.error).toBeUndefined(); expect(ended.state.temporaryTargetModifiers).toEqual([]);
    expect(evaluateCombat(ended.state, activeRuleset, ended.state.activePlayerId, target.targetId)).toMatchObject({ status: 'ready', evaluation: { requiredCombat: before.evaluation.requiredCombat } });
  });

  it('keeps resource 22 unavailable and rolls back direct dispatch when the public monster row has no candidate', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-22')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== itemId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== itemId);
    player.hand.push(itemId); state.cards[itemId]!.ownerId = player.id; state.phase = 'action1';
    const row = state.zones['base:monster-row']!; const deck = state.zones['base:monster-deck']!;
    for (const cardId of row.cardIds) {
      const target = Object.values(state.enemyTargets).find((candidate) => candidate.cardInstanceId === cardId);
      if (target) target.status = 'removed';
    }
    deck.cardIds.unshift(...row.cardIds); row.cardIds = [];
    const before = structuredClone(state);
    expect(getLegalCommands(state, activeRuleset, player.id)).not.toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    expect(getCpuActionFeatures(state, activeRuleset, player.id).some(({ command }) => command.type === 'USE_ITEM' && command.cardId === itemId)).toBe(false);
    const rejected = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-22-zero-candidate'));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
  });

  it('uses resource 28 by discarding an adventurer and drawing its combat value through Snapshot', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-28')!.id;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-21')!.id;
    const drawIds = state.players[1]!.hand.splice(0, 3);
    for (const cardId of [itemId, adventurerId]) {
      for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((candidate) => candidate !== cardId);
      for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((id) => id !== cardId);
      state.cards[cardId]!.ownerId = player.id;
    }
    for (const cardId of drawIds) state.cards[cardId]!.ownerId = player.id;
    player.hand.push(itemId, adventurerId); player.drawPile.push(...drawIds); state.phase = 'action1';
    const combatValue = activeRuleset.registry.definitions[state.cards[adventurerId]!.definitionId]!.combat!;
    const used = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-28-use'));
    expect(used.error).toBeUndefined(); expect(used.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'discard-card' });
    const restored = restoreSnapshot(serializeSnapshot(used.state), activeRuleset);
    const choice = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === adventurerId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, choice, 'resource-28-discard'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.discardPile).toContain(adventurerId);
    expect(completed.state.players[0]!.hand).toEqual(expect.arrayContaining(drawIds.slice(-combatValue)));
    expect(completed.state.players[0]!.playArea).toContain(itemId);
  });

  it('uses resource 23 once per turn to discard the whole party and hand before drawing five', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01', 'base:starter/adventurer-02']); const player = state.players[0]!;
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-23')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== itemId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== itemId);
    const drawIds = state.players[1]!.hand.splice(0, 5); for (const cardId of drawIds) state.cards[cardId]!.ownerId = player.id;
    player.hand.push(itemId); player.drawPile.push(...drawIds); state.cards[itemId]!.ownerId = player.id; state.phase = 'action1';
    const partyIds = player.party.flatMap(({ adventurerId, equipmentId }) => [adventurerId, ...(equipmentId ? [equipmentId] : [])]);
    const used = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-23-use'));
    expect(used.error).toBeUndefined(); expect(used.state.players[0]!.party).toEqual([]); expect(used.state.players[0]!.hand).toEqual(drawIds.slice().reverse());
    expect(used.state.players[0]!.discardPile).toEqual(expect.arrayContaining(partyIds)); expect(used.state.turnFacts?.effectUses?.['base:resource/resource-23']).toBe(1);
    expect(restoreSnapshot(serializeSnapshot(used.state), activeRuleset)).toEqual(used.state);

    const limited = structuredClone(state); limited.turnFacts!.effectUses = { 'base:resource/resource-23': 1 }; const before = structuredClone(limited);
    expect(getLegalCommands(limited, activeRuleset, player.id)).not.toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    const rejected = dispatch(limited, activeRuleset, envelope(limited, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-23-repeat'));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
  });

  it('uses resource 26 only before any defeat, draws three, and skips directly from action one to action two', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']); const player = state.players[0]!;
    const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-26')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== itemId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== itemId);
    const drawIds = state.players[1]!.hand.splice(0, 3); for (const cardId of drawIds) state.cards[cardId]!.ownerId = player.id;
    player.hand.push(itemId); player.drawPile.push(...drawIds); state.cards[itemId]!.ownerId = player.id; state.phase = 'action1';
    const used = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-26-use'));
    expect(used.error).toBeUndefined(); expect(used.state.players[0]!.hand).toEqual(expect.arrayContaining(drawIds)); expect(used.state.turnFacts?.combatSkipped).toBe(true);
    const skipped = dispatch(used.state, activeRuleset, envelope(used.state, player.id, { type: 'END_PHASE', phase: 'action1' }, 'resource-26-skip-combat'));
    expect(skipped.error).toBeUndefined(); expect(skipped.state.phase).toBe('action2'); expect(skipped.events.some(({ type }) => type === 'COMBAT_SKIP_SCHEDULED')).toBe(false);

    const defeated = structuredClone(state); defeated.turnFacts!.monstersDefeated = 1; const before = structuredClone(defeated);
    expect(getLegalCommands(defeated, activeRuleset, player.id)).not.toContainEqual({ type: 'USE_ITEM', cardId: itemId });
    const rejected = dispatch(defeated, activeRuleset, envelope(defeated, player.id, { type: 'USE_ITEM', cardId: itemId }, 'resource-26-after-defeat'));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before);
  });

  it('lets adventurer 12 move itself to the first party slot after entry and preserves the choice through Snapshot', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01', 'base:starter/adventurer-02']);
    const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-12')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== sourceId);
    player.hand.push(sourceId); state.cards[sourceId]!.ownerId = player.id; state.phase = 'action1';
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-12-enter'));
    expect(entered.error).toBeUndefined();
    expect(entered.state.players[0]!.party.at(-1)?.adventurerId).toBe(sourceId);
    const restored = restoreSnapshot(serializeSnapshot(entered.state), activeRuleset);
    const activate = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, activate, 'adventurer-12-move'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.party[0]!.adventurerId).toBe(sourceId);
  });

  it('runs adventurer 13 entry removal transactionally and permits the explicit optional skip', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']);
    const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-13')!.id;
    const removeId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-08')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId && cardId !== removeId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== sourceId && cardId !== removeId);
    player.hand.push(sourceId); player.discardPile.push(removeId); state.cards[sourceId]!.ownerId = player.id; state.cards[removeId]!.ownerId = player.id; state.phase = 'action1';
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-13-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'remove-card' });
    const restored = restoreSnapshot(serializeSnapshot(entered.state), activeRuleset);
    const remove = getLegalCommands(restored, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === removeId)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, remove, 'adventurer-13-remove'));
    expect(completed.error).toBeUndefined(); expect(completed.state.removedCards).toContain(removeId); expect(completed.state.revision).toBe(state.revision + 1);

    const skipState = structuredClone(state); skipState.revision = 0; skipState.eventLogCursor = 0;
    const skipEntered = dispatch(skipState, activeRuleset, envelope(skipState, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-13-enter-skip'));
    const skip = getLegalCommands(skipEntered.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip'))!;
    const skipped = dispatch(skipEntered.state, activeRuleset, envelope(skipEntered.state, player.id, skip, 'adventurer-13-skip'));
    expect(skipped.error).toBeUndefined(); expect(skipped.state.players[0]!.discardPile).toContain(removeId);
  });

  it('draws three then discards one for adventurer 17 entry without exposing a forged option', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']);
    const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-17')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== sourceId);
    player.hand.push(sourceId); state.cards[sourceId]!.ownerId = player.id; state.phase = 'action1';
    const handBefore = player.hand.length;
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-17-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.players[0]!.hand).toHaveLength(handBefore + 2); expect(entered.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'discard-card' });
    const pending = entered.state.effectState.pendingChoice!;
    const forged = dispatch(entered.state, activeRuleset, envelope(entered.state, player.id, { type: 'RESOLVE_EFFECT_CHOICE', executionId: pending.executionId, choiceId: pending.choiceId, optionId: 'forged' }, 'adventurer-17-forged'));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state).toEqual(entered.state);
    const discard = getLegalCommands(entered.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(entered.state, activeRuleset, envelope(entered.state, player.id, discard, 'adventurer-17-discard'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.hand).toHaveLength(handBefore + 1); expect(completed.state.revision).toBe(state.revision + 1);
  });

  it('draws once on both adventurer 28 entry and a later equipment attachment', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']);
    const player = state.players[0]!;
    const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-28')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== sourceId);
    player.hand.push(sourceId); state.cards[sourceId]!.ownerId = player.id; state.phase = 'action1';
    const handBefore = player.hand.length;
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: sourceId }, 'adventurer-28-enter'));
    expect(entered.error).toBeUndefined(); expect(entered.state.players[0]!.hand).toHaveLength(handBefore);
    const equipmentId = entered.state.players[0]!.hand.find((cardId) => entered.state.cards[cardId]?.definitionId === 'base:starter/spirit-crystal')!;
    const equipped = dispatch(entered.state, activeRuleset, envelope(entered.state, player.id, { type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId: sourceId }, 'adventurer-28-equip'));
    expect(equipped.error).toBeUndefined(); expect(equipped.state.players[0]!.hand).toHaveLength(handBefore); expect(equipped.state.players[0]!.party.find(({ adventurerId }) => adventurerId === sourceId)?.equipmentId).toBe(equipmentId);
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

  it.each([
    ['base:monster/monster-04', 'base:adventurer-row', 'base:adventurer-deck', 3, ['adventurer']],
    ['base:monster/monster-07', 'base:item-row', 'base:item-deck', 3, ['item', 'equipment']],
    ['base:monster/monster-08', 'base:item-row', 'base:item-deck', 4, ['item', 'equipment']],
    ['base:monster/monster-12', 'base:adventurer-row', 'base:adventurer-deck', 4, ['adventurer']],
  ] as const)('grants the optional typed one-card public-row reward for %s across Snapshot and zero candidates', (definitionId, rowId, deckId, maximumCost, types) => {
    const activeRuleset = ruleset();
    const makeState = (suffix: string) => {
      const state = finishBondSetup(createGame({ gameId: `${definitionId}-${suffix}`, seed: suffix === 'normal' ? 211 : 223, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
      const targetId = replaceTarget(state, 'monster', definitionId);
      state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
      return { state, targetId };
    };
    const predicate = (definition: (typeof activeRuleset.registry.definitions)[string]) => types.includes(definition.type as never) && (definition.cost ?? Number.POSITIVE_INFINITY) <= maximumCost;
    const normal = makeState('normal');
    const [selected] = arrangePublicRow(normal.state, activeRuleset, rowId, deckId, predicate, true);
    const attacked = dispatch(normal.state, activeRuleset, envelope(normal.state, 'p1', { type: 'ATTACK_TARGET', targetId: normal.targetId }, `${definitionId}:root`));
    expect(attacked.error).toBeUndefined();
    const activate = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const activated = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', activate, `${definitionId}:activate`));
    expect(activated.error).toBeUndefined();
    expect(activated.state.effectState.pendingChoice).toMatchObject({ decisionKind: 'choose-market-card' });
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(activated.state))), activeRuleset);
    const choose = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === selected)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', choose, `${definitionId}:choose`));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.discardPile).toContain(selected);
    expect(completed.state.enemyTargets[normal.targetId]!.status).toBe('defeated');

    const empty = makeState('empty');
    arrangePublicRow(empty.state, activeRuleset, rowId, deckId, predicate, false);
    const emptyAttack = dispatch(empty.state, activeRuleset, envelope(empty.state, 'p1', { type: 'ATTACK_TARGET', targetId: empty.targetId }, `${definitionId}:empty-root`));
    const emptyActivate = getLegalCommands(emptyAttack.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const zeroCandidate = dispatch(emptyAttack.state, activeRuleset, envelope(emptyAttack.state, 'p1', emptyActivate, `${definitionId}:empty-activate`));
    expect(zeroCandidate.error).toBeUndefined();
    expect(zeroCandidate.state.effectState.pendingChoice).toBeUndefined();
    expect(zeroCandidate.state.enemyTargets[empty.targetId]!.status).toBe('defeated');
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
    [['base:starter/adventurer-01', 'base:adventurer/adventurer-14', 'base:starter/adventurer-02'], [2, 0, 3]],
  ] as const)('computes enabled position/party combat for %j', (definitionIds, expectedCombat) => {
    const { state, activeRuleset } = gameWithParty(definitionIds);
    const before = structuredClone(state);
    const result = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1' });
    expect(result.status === 'ready' ? result.evaluation.members.map(({ effectiveCombat }) => effectiveCombat) : result).toEqual(expectedCombat);
    expect(state).toEqual(before);
  });

  it('discards adventurer 14 and its attachments when it becomes the first party member', () => {
    const { state, activeRuleset } = gameWithParty(['base:starter/adventurer-01']);
    const player = state.players[0]!;
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-14')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== adventurerId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== adventurerId);
    player.discardPile.push(...player.party.flatMap((slot) => [slot.adventurerId, ...attachedCardIds(slot)]));
    player.party = [];
    player.hand.push(adventurerId);
    state.cards[adventurerId]!.ownerId = player.id;
    state.phase = 'action1';
    const entered = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: adventurerId }, 'adventurer-14-enter'));
    expect(entered.error).toBeUndefined();
    expect(entered.state.players[0]!.party).toEqual([]);
    expect(entered.state.players[0]!.discardPile).toContain(adventurerId);
    expect(entered.events).toContainEqual(expect.objectContaining({ type: 'PARTY_MEMBER_DISCARDED' }));
    expect(restoreSnapshot(serializeSnapshot(entered.state), activeRuleset)).toEqual(entered.state);
  });

  it('offers adventurer 21 an optional combat departure replacement with rollback-safe Snapshot continuation', () => {
    const { state, activeRuleset, selectedIds } = gameWithParty(['base:adventurer/adventurer-21']); const adventurerId = selectedIds[0]!;
    state.phase = 'combat'; state.players[0]!.turnCombatBonus = 0;
    const targetId = replaceTarget(state, 'monster', 'base:monster/monster-09');
    const suspended = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'adventurer-21-attack'));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-departure-choice');
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), activeRuleset);
    expect(getLegalCommands(restored, activeRuleset, 'p1').filter(({ type }) => type === 'RESOLVE_EFFECT_CHOICE')).toHaveLength(2);
    const beforeForged = structuredClone(restored);
    expect(dispatch(restored, activeRuleset, envelope(restored, 'p1', { type: 'RESOLVE_EFFECT_CHOICE', executionId: 'combat-departure:adventurer-21-attack', choiceId: 'combat-departure:optional-replacements', optionId: 'forged' })).state).toEqual(beforeForged);
    const replace = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'departure-1')!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', replace, 'adventurer-21-replace'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.party).toEqual([]); expect(completed.state.players[0]!.drawPile.at(-1)).toBe(adventurerId); expect(completed.state.players[0]!.discardPile).not.toContain(adventurerId);
  });

  it('lets adventurer 19 discard its enemy attachment instead of leaving combat', () => {
    const { state, activeRuleset, selectedIds } = gameWithParty(['base:adventurer/adventurer-19']); const adventurerId = selectedIds[0]!; const player = state.players[0]!;
    const attachmentId = state.zones['base:monster-deck']!.cardIds.find((cardId) => {
      const definition = activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!;
      return definition.type === 'monster' && !definition.tags?.includes('base:supply-cycle-anchor');
    })!;
    state.zones['base:monster-deck']!.cardIds.splice(state.zones['base:monster-deck']!.cardIds.indexOf(attachmentId), 1); player.hand.push(attachmentId); state.cards[attachmentId]!.ownerId = player.id; state.phase = 'action1';
    const attached = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACH_CARD', cardId: attachmentId, adventurerId }, 'adventurer-19-attach'));
    expect(attached.error).toBeUndefined(); attached.state.phase = 'combat'; attached.state.players[0]!.turnCombatBonus = 0;
    const targetId = replaceTarget(attached.state, 'monster', 'base:monster/monster-09');
    const suspended = dispatch(attached.state, activeRuleset, envelope(attached.state, player.id, { type: 'ATTACK_TARGET', targetId }, 'adventurer-19-attack'));
    expect(suspended.error).toBeUndefined(); expect(suspended.state.effectState.pendingCommand?.kind).toBe('combat-departure-choice');
    const replace = getLegalCommands(suspended.state, activeRuleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'departure-1')!;
    const completed = dispatch(suspended.state, activeRuleset, envelope(suspended.state, player.id, replace, 'adventurer-19-replace'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.party).toEqual([{ adventurerId }]); expect(completed.state.players[0]!.discardPile).toContain(attachmentId); expect(completed.state.players[0]!.discardPile).not.toContain(adventurerId);
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

  it('adds resource 09 combat only against bosses and keeps query, dispatch, CPU, and Snapshot aligned', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'resource-09-boss-only', seed: 37, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset), activeRuleset);
    const player = state.players[0]!; const slot = player.party[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-09')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) for (const key of ['hand', 'drawPile', 'discardPile', 'playArea'] as const) candidate[key] = candidate[key].filter((cardId) => cardId !== equipmentId);
    slot.equipmentIds = [equipmentId]; state.cards[equipmentId]!.ownerId = player.id; state.phase = 'combat'; player.turnCombatBonus = 100;
    const boss = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const monster = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    const input = { schemaVersion: 1 as const, playerId: player.id, equipmentCardId: equipmentId, adventurerId: slot.adventurerId };

    expect(evaluateEquipmentCombatModifiers(state, activeRuleset, { ...input, targetId: monster.targetId })).toMatchObject({ status: 'ready', evaluation: { powerBonus: 0, appliedRules: [] } });
    expect(evaluateEquipmentCombatModifiers(state, activeRuleset, { ...input, targetId: boss.targetId })).toMatchObject({ status: 'ready', evaluation: { powerBonus: 2, appliedRules: [{ ruleId: 'resource-09-boss-bonus' }] } });
    const monsterParty = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: player.id, targetId: monster.targetId });
    const bossParty = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: player.id, targetId: boss.targetId });
    if (monsterParty.status !== 'ready' || bossParty.status !== 'ready') throw new Error('Expected ready party evaluations.');
    expect(bossParty.evaluation.members[0]!.effectiveCombat).toBe(monsterParty.evaluation.members[0]!.effectiveCombat + 2);
    const bossCommand = { type: 'ATTACK_TARGET' as const, targetId: boss.targetId };
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual(bossCommand);
    expect(getCpuActionFeatures(state, activeRuleset, player.id)).toEqual(expect.arrayContaining([expect.objectContaining({ command: bossCommand, bossProgress: 1 })]));
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    expect(evaluateEquipmentCombatModifiers(restored, activeRuleset, { ...input, targetId: boss.targetId })).toMatchObject({ status: 'ready', evaluation: { powerBonus: 2 } });
    const completed = dispatch(restored, activeRuleset, envelope(restored, player.id, bossCommand, 'resource-09-boss'));
    expect(completed.error).toBeUndefined(); expect(completed.state.players[0]!.history.defeatedBosses).toBe(1);
    const before = structuredClone(state);
    const forged = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'ATTACK_TARGET', targetId: 'missing-target' }, 'resource-09-forged'));
    expect(forged.error?.code).toBe('INVALID_COMMAND'); expect(forged.state).toEqual(before);
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

  it('restricts resource 14 to melee/support and resolves its combat departure across legal, dispatch and Snapshot', () => {
    const { state, activeRuleset } = gameWithParty(['base:adventurer/adventurer-06', 'base:adventurer/adventurer-07']);
    const player = state.players[0]!;
    const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-14')!.id;
    for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== equipmentId);
    for (const candidate of state.players) {
      candidate.hand = candidate.hand.filter((cardId) => cardId !== equipmentId);
      candidate.drawPile = candidate.drawPile.filter((cardId) => cardId !== equipmentId);
      candidate.discardPile = candidate.discardPile.filter((cardId) => cardId !== equipmentId);
      candidate.playArea = candidate.playArea.filter((cardId) => cardId !== equipmentId);
    }
    player.hand.push(equipmentId); state.cards[equipmentId]!.ownerId = player.id; state.phase = 'action1';
    const meleeId = player.party[0]!.adventurerId; const rangedId = player.party[1]!.adventurerId;
    expect(evaluateEquipmentEligibility(state, activeRuleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: equipmentId, adventurerId: meleeId })).toMatchObject({ status: 'ready', evaluation: { eligible: true } });
    expect(evaluateEquipmentEligibility(state, activeRuleset, { schemaVersion: 1, playerId: player.id, equipmentCardId: equipmentId, adventurerId: rangedId })).toMatchObject({ status: 'ready', evaluation: { eligible: false, rejectionReasonCodes: ['RESOURCE_14_REQUIRES_MELEE_OR_SUPPORT'] } });
    expect(getLegalCommands(state, activeRuleset, player.id)).toContainEqual({ type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId: meleeId });
    expect(getLegalCommands(state, activeRuleset, player.id)).not.toContainEqual({ type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId: rangedId });
    const equipped = dispatch(state, activeRuleset, envelope(state, player.id, { type: 'EQUIP_ITEM', cardId: equipmentId, adventurerId: meleeId }, 'resource-14-equip'));
    expect(equipped.error).toBeUndefined();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(equipped.state))), activeRuleset);
    expect(evaluateEquipmentDeparture(restored, activeRuleset, { schemaVersion: 1, playerId: player.id, adventurerId: meleeId, equipmentCardId: equipmentId, cause: 'combat-discard' })).toMatchObject({ status: 'ready', evaluation: { disposition: 'remove-from-game', appliedPolicy: { policyId: 'resource-14-combat-removal' } } });
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

  it('lets monster 13 atomically replace the complete hand and resume after Snapshot', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-13');
    const replacementCards = state.players[1]!.hand.splice(0);
    state.players[0]!.drawPile.push(...replacementCards);
    for (const cardId of replacementCards) state.cards[cardId]!.ownerId = 'p1';
    const beforeHand = [...state.players[0]!.hand];
    expect(beforeHand.length).toBeGreaterThan(0);
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    expect(attacked.error).toBeUndefined();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(attacked.state))), activeRuleset);
    const activate = getLegalCommands(restored, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':activate'))!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p1', activate));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.discardPile).toEqual(expect.arrayContaining(beforeHand));
    expect(completed.state.players[0]!.hand).toHaveLength(beforeHand.length);
    expect(completed.state.players[0]!.hand).not.toEqual(beforeHand);
    expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
    expect(completed.events).toContainEqual(expect.objectContaining({ type: 'HAND_DISCARDED' }));
  });

  it('lets monster 05 reveal one item per player and complete a leftward multi-actor draft through Snapshot', () => {
    const { state, activeRuleset, targetId } = gameWithTarget('base:monster/monster-05');
    const attacked = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'monster-05-root'));
    expect(attacked.error).toBeUndefined();
    const draft = attacked.state.zones[baseProvisionalOriginalFullZoneIds.rewardDraft]!;
    expect(draft.cardIds).toHaveLength(2);
    expect(attacked.state.effectState.pendingChoice).toMatchObject({ actorId: 'p1', decisionKind: 'draft-card' });
    expect(projectPlayerView(attacked.state, activeRuleset, 'p1').zones[baseProvisionalOriginalFullZoneIds.rewardDraft]?.cardIds).toEqual(draft.cardIds);
    expect(projectPlayerView(attacked.state, activeRuleset, 'p2').zones[baseProvisionalOriginalFullZoneIds.rewardDraft]?.cardIds).toEqual(draft.cardIds);

    const firstCard = draft.cardIds[0]!;
    const first = getLegalCommands(attacked.state, activeRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === firstCard)!;
    const firstPick = dispatch(attacked.state, activeRuleset, envelope(attacked.state, 'p1', first, 'monster-05-p1'));
    expect(firstPick.error).toBeUndefined();
    expect(firstPick.state.effectState.pendingChoice).toMatchObject({ actorId: 'p2', decisionKind: 'draft-card' });
    expect(firstPick.state.players[0]!.hand).toContain(firstCard);

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(firstPick.state))), activeRuleset);
    const secondCard = restored.zones[baseProvisionalOriginalFullZoneIds.rewardDraft]!.cardIds[0]!;
    const second = getLegalCommands(restored, activeRuleset, 'p2').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === secondCard)!;
    const completed = dispatch(restored, activeRuleset, envelope(restored, 'p2', second, 'monster-05-p2'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.zones[baseProvisionalOriginalFullZoneIds.rewardDraft]!.cardIds).toEqual([]);
    expect(completed.state.players[1]!.hand).toContain(secondCard);
    expect(completed.state.cards[firstCard]!.ownerId).toBe('p1');
    expect(completed.state.cards[secondCard]!.ownerId).toBe('p2');
    expect(completed.state.enemyTargets[targetId]!.status).toBe('defeated');
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
    'base:monster/monster-13',
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

  it('implements adventurer 22 enemy purchase power as attachment combat through one authoritative command', () => {
    const fixture = gameWithParty(['base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04', 'base:starter/adventurer-05', 'base:adventurer/adventurer-22']); const activeRuleset = fixture.activeRuleset; let state = fixture.state; const wearerId = fixture.selectedIds[5]!;
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!; const targetId = target.targetId; const monsterId = target.cardInstanceId;
    state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
    let completed = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }));
    while (!completed.error && (completed.state.effectState.pendingChoice || completed.state.effectState.pendingCounterConsent || completed.state.effectState.pendingCommand)) {
      const choices = getLegalCommands(completed.state, activeRuleset, 'p1'); const choice = choices.find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId.endsWith(':skip')) ?? choices[0];
      if (!choice) break; completed = dispatch(completed.state, activeRuleset, envelope(completed.state, 'p1', choice));
    }
    expect(completed.error).toBeUndefined(); state = completed.state;
    const player = state.players[0]!;
    player.discardPile = player.discardPile.filter((id) => id !== monsterId); player.hand.push(monsterId); state.phase = 'action2';
    const evaluation = evaluateAttachment(state, activeRuleset, { schemaVersion: 1, playerId: player.id, cardId: monsterId, adventurerId: wearerId });
    expect(evaluation).toMatchObject({ status: 'ready', evaluation: { eligible: true, capacity: 1, combatContribution: 'printed-purchase-power' } });
    const legal = getLegalCommands(state, activeRuleset, player.id);
    const command = legal.find((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === monsterId && candidate.adventurerId === wearerId);
    expect(command, JSON.stringify(legal)).toBeDefined();
    const attached = dispatch(state, activeRuleset, envelope(state, player.id, command!)); expect(attached.error).toBeUndefined();
    const combat = evaluatePartyCombat(attached.state, activeRuleset, { schemaVersion: 1, playerId: player.id });
    expect(combat.status === 'ready' ? combat.evaluation.members.at(-1)?.equipmentCombat : undefined).toBe(activeRuleset.registry.definitions[state.cards[monsterId]!.definitionId]!.purchasePower);
  });

  it('implements adventurer 25 as +2 attachment and adventurer 29 ordered three-equipment capacity', () => {
    const { state, activeRuleset, selectedIds: [wearerId] } = gameWithParty(['base:adventurer/adventurer-29']); let current = state; const playerId = 'p1';
    const attachmentId = Object.values(current.cards).find(({ definitionId }) => definitionId === 'base:adventurer/adventurer-25')!.id;
    const equipmentIds = Object.values(current.cards).filter(({ definitionId }) => definitionId === 'base:resource/resource-02').map(({ id }) => id);
    for (const cardId of [attachmentId, ...equipmentIds]) {
      for (const zone of Object.values(current.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== cardId);
      for (const candidate of current.players) { candidate.hand = candidate.hand.filter((id) => id !== cardId); candidate.drawPile = candidate.drawPile.filter((id) => id !== cardId); candidate.discardPile = candidate.discardPile.filter((id) => id !== cardId); }
      current.cards[cardId]!.ownerId = playerId; current.players[0]!.hand.push(cardId);
    }
    const attachAdventurer = getLegalCommands(current, activeRuleset, playerId).find((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === attachmentId && candidate.adventurerId === wearerId)!;
    let result = dispatch(current, activeRuleset, envelope(current, playerId, attachAdventurer)); expect(result.error).toBeUndefined(); current = result.state;
    expect(evaluatePartyCombat(current, activeRuleset, { schemaVersion: 1, playerId }).status === 'ready' ? (evaluatePartyCombat(current, activeRuleset, { schemaVersion: 1, playerId }) as Extract<ReturnType<typeof evaluatePartyCombat>, { status: 'ready' }>).evaluation.members[0]?.equipmentCombat : undefined).toBe(2);
    for (const equipmentId of equipmentIds.slice(0, 2)) {
      const command = getLegalCommands(current, activeRuleset, playerId).find((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === equipmentId && candidate.adventurerId === wearerId)!;
      result = dispatch(current, activeRuleset, envelope(current, playerId, command)); expect(result.error).toBeUndefined(); current = result.state;
    }
    expect(attachedCardIds(current.players[0]!.party[0]!)).toEqual([attachmentId, ...equipmentIds.slice(0, 2)]);
    const fullCommands = getLegalCommands(current, activeRuleset, playerId).filter((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === equipmentIds[2] && candidate.adventurerId === wearerId);
    expect(fullCommands).toHaveLength(3); expect(fullCommands.every((command) => command.type === 'ATTACH_CARD' && command.replaceCardId)).toBe(true);
  });

  it.each([
    ['base:boss/boss-04', 'remove-from-game'],
    ['base:boss/boss-07', 'winner-discard'],
  ] as const)('attaches a public deck card to %s and resolves its combat, reward, and terminal disposition', (definitionId, disposition) => {
    const activeRuleset = ruleset(); const state = finishBondSetup(createGame({ gameId: `enemy-attachment-${definitionId}`, seed: 83, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, activeRuleset), activeRuleset);
    const firstBoss = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available')!;
    for (const cardId of firstBoss.attachments.splice(0)) state.zones[activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'monster' ? 'base:monster-deck' : 'base:adventurer-deck']!.cardIds.unshift(cardId);
    const targetId = replaceTarget(state, 'boss', definitionId); const target = state.enemyTargets[targetId]!;
    applyEnemyEntryAttachment(state, activeRuleset, target); expect(target.attachments).toHaveLength(1); const attachmentId = target.attachments[0]!;
    const targetDefinition = activeRuleset.registry.definitions[definitionId]!; const attachmentDefinition = activeRuleset.registry.definitions[state.cards[attachmentId]!.definitionId]!;
    const combat = evaluateCombat(state, activeRuleset, 'p1', targetId);
    expect(combat).toMatchObject({ status: 'ready', evaluation: { requiredCombat: (targetDefinition.combat ?? 0) + (attachmentDefinition.combat ?? 0) } });
    if (definitionId.endsWith('04')) state.players[0]!.drawPile.push(...state.players[0]!.hand.splice(0, 4));
    const beforeHand = state.players[0]!.hand.length; state.phase = 'combat'; state.players[0]!.turnCombatBonus = 100;
    const completed = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId })); expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.turnPurchaseBonus).toBe(5); expect(completed.state.enemyTargets[targetId]!.attachments).toEqual([]);
    if (definitionId.endsWith('04')) expect(completed.state.players[0]!.hand.length).toBe(beforeHand + 4);
    if (disposition === 'remove-from-game') expect(completed.state.removedCards).toContain(attachmentId);
    else expect(completed.state.players[0]!.discardPile).toContain(attachmentId);
  });

  it('does not consume a protected monster cycle anchor for a boss entry attachment', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'enemy-attachment-cycle-anchor', seed: 83, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-04');
    const target = state.enemyTargets[targetId]!;
    for (const cardId of target.attachments.splice(0)) state.zones['base:monster-deck']!.cardIds.unshift(cardId);

    const monsterIds = Object.values(state.cards).filter(({ definitionId }) => activeRuleset.registry.definitions[definitionId]?.type === 'monster').map(({ id }) => id);
    const anchorIds = monsterIds.filter((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.tags?.includes('base:supply-cycle-anchor'));
    const ordinaryId = monsterIds.find((cardId) => !anchorIds.includes(cardId))!;
    state.zones['base:monster-row']!.cardIds = [anchorIds[0]!, anchorIds[1]!, ordinaryId];
    state.zones['base:monster-deck']!.cardIds = [anchorIds[2]!];
    state.removedCards.push(...monsterIds.filter((cardId) => !state.zones['base:monster-row']!.cardIds.includes(cardId) && !state.zones['base:monster-deck']!.cardIds.includes(cardId)));
    for (const monsterTarget of Object.values(state.enemyTargets).filter(({ kind }) => kind === 'monster')) monsterTarget.status = 'defeated';
    attachTargets(state, activeRuleset);

    expect(validateSupplyContinuityState(state, activeRuleset)).toEqual([]);
    applyEnemyEntryAttachment(state, activeRuleset, target);
    expect(target.attachments).toEqual([]);
    expect(state.zones['base:monster-deck']!.cardIds).toEqual([anchorIds[2]]);
    expect(validateSupplyContinuityState(state, activeRuleset)).toEqual([]);
  });

  it('does not search below a protected top card for an enemy entry attachment', () => {
    const activeRuleset = ruleset();
    const state = finishBondSetup(createGame({ gameId: 'enemy-attachment-preserves-deck-order', seed: 83, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, activeRuleset), activeRuleset);
    const targetId = replaceTarget(state, 'boss', 'base:boss/boss-04');
    const target = state.enemyTargets[targetId]!;
    for (const cardId of target.attachments.splice(0)) state.zones['base:monster-deck']!.cardIds.unshift(cardId);

    const monsterIds = Object.values(state.cards).filter(({ definitionId }) => activeRuleset.registry.definitions[definitionId]?.type === 'monster').map(({ id }) => id);
    const anchorIds = monsterIds.filter((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.tags?.includes('base:supply-cycle-anchor'));
    const ordinaryIds = monsterIds.filter((cardId) => !anchorIds.includes(cardId));
    state.zones['base:monster-row']!.cardIds = [anchorIds[0]!, anchorIds[1]!, ordinaryIds[0]!];
    state.zones['base:monster-deck']!.cardIds = [ordinaryIds[1]!, anchorIds[2]!];
    state.removedCards.push(...monsterIds.filter((cardId) => !state.zones['base:monster-row']!.cardIds.includes(cardId) && !state.zones['base:monster-deck']!.cardIds.includes(cardId)));
    for (const monsterTarget of Object.values(state.enemyTargets).filter(({ kind }) => kind === 'monster')) monsterTarget.status = 'defeated';
    attachTargets(state, activeRuleset);
    const beforeDeck = [...state.zones['base:monster-deck']!.cardIds];

    expect(validateSupplyContinuityState(state, activeRuleset)).toEqual([]);
    applyEnemyEntryAttachment(state, activeRuleset, target);
    expect(target.attachments).toEqual([]);
    expect(state.zones['base:monster-deck']!.cardIds).toEqual(beforeDeck);
    expect(validateSupplyContinuityState(state, activeRuleset)).toEqual([]);
  });
});
