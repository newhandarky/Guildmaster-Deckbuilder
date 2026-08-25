import { describe, expect, it } from 'vitest';
import { baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { baseHelperZoneIds, baseHelpersRulesModule, baseProvisionalHelpersContentPack } from '@guildmaster/content-base-helpers';
import { customAdventurerCapabilityMatrix, customAdventurerContentPack, customAdventurerRulesModuleId } from '@guildmaster/content-custom-adventurers';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateCombat, evaluateCombatAssist, evaluateCombatDepartureReplacements, evaluateCombatParticipantDeparture, evaluateCombatPartyPrefix, evaluatePartyCombat, getCpuActionFeatures, getLegalCommands, projectPlayerView, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
import { customAdventurerHelperRulesModule, customAdventurerHelperRulesModuleId, customAdventurerRulesModule } from '../src/index.js';

const activeRuleset = () => createRuleset(
  [baseProvisionalOriginalFullContentPack, customAdventurerContentPack],
  [baseRulesModule, customAdventurerRulesModule],
  { allowProvisionalPlaytest: true },
);

function finishBondSetup(initialState: ReturnType<typeof createGame>, ruleset: ReturnType<typeof activeRuleset>) {
  let state = initialState;
  while (state.bondSetup) {
    const actorId = state.bondSetup.currentActorId;
    const command = getLegalCommands(state, ruleset, actorId).find(({ type }) => type === 'SELECT_BONDS');
    if (!command) throw new Error('Custom fixture has no legal bond selection.');
    const result = dispatch(state, ruleset, envelope(state, actorId, command));
    if (result.error) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

function customGame() {
  const ruleset = activeRuleset();
  const state = finishBondSetup(createGame({
    gameId: 'custom-effect-test', seed: 73, startingPlayerId: 'p1',
    players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
  }, ruleset), ruleset);
  return { state, ruleset };
}

function customHelperGame() {
  const helperPack = {
    ...baseProvisionalHelpersContentPack,
    manifest: {
      ...baseProvisionalHelpersContentPack.manifest,
      id: 'custom:test-helpers',
      dependencies: [baseProvisionalOriginalFullContentPack.manifest.id, customAdventurerContentPack.manifest.id],
    },
    rulesModuleIds: [baseHelpersRulesModule.id, customAdventurerHelperRulesModuleId],
  };
  const ruleset = createRuleset(
    [baseProvisionalOriginalFullContentPack, customAdventurerContentPack, helperPack],
    [baseRulesModule, customAdventurerRulesModule, baseHelpersRulesModule, customAdventurerHelperRulesModule],
    { allowProvisionalPlaytest: true },
  );
  const state = finishBondSetup(createGame({
    gameId: 'custom-helper-effect-test', seed: 91, startingPlayerId: 'p1',
    players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
  }, ruleset), ruleset);
  return { state, ruleset };
}

function takeCard(state: ReturnType<typeof createGame>, definitionId: string): string {
  const cardId = Object.values(state.cards).find((card) => card.definitionId === definitionId)?.id;
  if (!cardId) throw new Error(`Missing fixture card ${definitionId}.`);
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== cardId);
  for (const player of state.players) {
    player.hand = player.hand.filter((id) => id !== cardId);
    player.drawPile = player.drawPile.filter((id) => id !== cardId);
    player.discardPile = player.discardPile.filter((id) => id !== cardId);
    player.playArea = player.playArea.filter((id) => id !== cardId);
    player.party = player.party.filter(({ adventurerId }) => adventurerId !== cardId);
  }
  return cardId;
}

function replaceParty(state: ReturnType<typeof createGame>, definitionIds: readonly string[]): string[] {
  const player = state.players[0]!;
  player.discardPile.push(...player.party.flatMap((slot) => [slot.adventurerId, ...(slot.equipmentIds ?? (slot.equipmentId ? [slot.equipmentId] : []))]));
  const cardIds = definitionIds.map((definitionId) => takeCard(state, definitionId));
  player.party = cardIds.map((adventurerId) => ({ adventurerId }));
  for (const cardId of cardIds) state.cards[cardId]!.ownerId = player.id;
  return cardIds;
}

describe('custom adventurer rules', () => {
  it('rewrites audited base mechanics to explicit custom definition IDs', () => {
    expect(customAdventurerRulesModule.id).toBe(customAdventurerRulesModuleId);
    expect(customAdventurerRulesModule.equipmentEligibilityRules?.[0]?.when).toMatchObject({
      definitionIds: ['custom:adventurer/melee-02'],
    });
    expect(customAdventurerRulesModule.partyCombatModifierRules?.map(({ sourceDefinitionIds }) => sourceDefinitionIds[0])).toEqual([
      'custom:adventurer/tank-01',
      'custom:adventurer/melee-05',
      'custom:adventurer/melee-04',
      'custom:adventurer/ranged-01',
      'custom:adventurer/mage-04',
      'custom:adventurer/melee-09',
      'custom:adventurer/support-04',
      'base:resource/resource-11',
      'custom:adventurer/tank-06',
      'custom:adventurer/mage-07',
      'custom:adventurer/tank-09',
    ]);
    const serializedRules = JSON.stringify(customAdventurerRulesModule);
    for (const { contentId } of customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked')) {
      expect(serializedRules).not.toContain(contentId);
    }
  });

  it('rejects overlapping combat-assist policies instead of silently disabling the command', () => {
    const policy = customAdventurerRulesModule.combatAssistPolicies?.find(({ sourceDefinitionIds }) => sourceDefinitionIds.includes('custom:adventurer/mage-06'));
    if (!policy) throw new Error('Expected custom mage 06 combat-assist policy.');
    const ambiguous = { ...customAdventurerRulesModule, combatAssistPolicies: [...(customAdventurerRulesModule.combatAssistPolicies ?? []), { ...policy, policyId: 'custom-mage-06-overlap' }] };
    expect(() => createRuleset([baseProvisionalOriginalFullContentPack, customAdventurerContentPack], [baseRulesModule, ambiguous], { allowProvisionalPlaytest: true })).toThrow('ambiguously overlaps');
  });

  it('lets custom mage 06 halve an enemy requirement while staying out of combat, then removes itself', () => {
    const { state, ruleset } = customGame();
    const [starterId, yunyunId, meguminId] = replaceParty(state, ['custom:starter/melee', 'custom:adventurer/tank-07', 'custom:adventurer/mage-06']) as [string, string, string];
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!;
    const base = evaluateCombat(state, ruleset, 'p1', target.targetId);
    if (base.status !== 'ready') throw new Error(base.error);
    state.temporaryTargetModifiers = [{ modifierId: 'megumin-odd-requirement', moduleId: customAdventurerRulesModuleId, targetCardId: target.cardInstanceId, amount: 5 - base.evaluation.requiredCombat, expiresAtTurnEndPlayerId: 'p1' }];
    state.phase = 'combat'; state.players[0]!.turnCombatBonus = 0;

    expect(evaluateCombatAssist(state, ruleset, 'p1', target.targetId, meguminId)).toMatchObject({ combat: { requiredCombat: 3 }, partyPrefix: { slotCount: 2, participantCardIds: [starterId, yunyunId] } });
    const legal = getLegalCommands(state, ruleset, 'p1');
    expect(legal).not.toContainEqual({ type: 'ATTACK_TARGET', targetId: target.targetId });
    const command = legal.find((candidate) => candidate.type === 'ATTACK_TARGET' && candidate.targetId === target.targetId && candidate.combatAssistCardId === meguminId);
    if (!command) throw new Error('Expected Megumin combat-assist attack.');
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', command, 'custom-mage-06-assist'));
    expect(suspended.error).toBeUndefined();
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), ruleset);
    const declineKeep = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.optionId === 'departure-0');
    if (!declineKeep) throw new Error('Expected Snapshot-safe combat departure choice.');
    const result = dispatch(restored, ruleset, envelope(restored, 'p1', declineKeep, 'custom-mage-06-departure'));
    expect(result.error).toBeUndefined();
    expect(result.state.removedCards).toContain(meguminId);
    expect(result.state.players[0]!.party.some(({ adventurerId }) => adventurerId === meguminId)).toBe(false);
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'COMBAT_ASSIST_APPLIED' })]));
  });

  it('keeps assisted attack legality aligned through command-before choice and random previews', () => {
    const prepare = (kind: 'choice' | 'random') => {
      const module = {
        ...customAdventurerRulesModule,
        version: kind === 'choice' ? '0.9.1-test' : '0.9.2-test',
        lifecycleHooks: [...(customAdventurerRulesModule.lifecycleHooks ?? []), {
          schemaVersion: 1 as const, hookId: `test-mage-06-${kind}-before-attack`, moduleId: customAdventurerRulesModuleId,
          point: 'command-before' as const, kind: 'trigger' as const, priority: 999,
          effect: { schemaVersion: 1 as const, effectId: `test-mage-06-${kind}-before-attack`, body: kind === 'choice'
            ? { kind: 'choice' as const, choiceId: 'test-mage-06-prepare', actor: { kind: 'controller' as const }, options: [
                { id: 'stay', effect: { kind: 'modify-value' as const, target: { kind: 'turn-combat-bonus' as const, player: { kind: 'controller' as const } }, amount: 0 } },
                { id: 'boost', effect: { kind: 'modify-value' as const, target: { kind: 'turn-combat-bonus' as const, player: { kind: 'controller' as const } }, amount: 1 } },
              ] }
            : { kind: 'random' as const, randomId: 'test-mage-06-random-prepare', outcomes: [{ id: 'boost', effect: { kind: 'modify-value' as const, target: { kind: 'turn-combat-bonus' as const, player: { kind: 'controller' as const } }, amount: 1 } }] } },
        }],
      };
      const ruleset = createRuleset([baseProvisionalOriginalFullContentPack, customAdventurerContentPack], [baseRulesModule, module], { allowProvisionalPlaytest: true });
      const state = finishBondSetup(createGame({ gameId: `mage-06-${kind}-preview`, seed: 73, startingPlayerId: 'p1', players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset), ruleset);
      const [, meguminId] = replaceParty(state, ['custom:starter/melee', 'custom:adventurer/mage-06']) as [string, string];
      const target = Object.values(state.enemyTargets).find(({ kind: targetKind, status }) => targetKind === 'monster' && status === 'available')!;
      const combat = evaluateCombat(state, ruleset, 'p1', target.targetId); if (combat.status !== 'ready') throw new Error(combat.error);
      state.temporaryTargetModifiers = [{ modifierId: `mage-06-${kind}-five`, moduleId: customAdventurerRulesModuleId, targetCardId: target.cardInstanceId, amount: 5 - combat.evaluation.requiredCombat, expiresAtTurnEndPlayerId: 'p1' }];
      state.phase = 'combat'; state.players[0]!.turnCombatBonus = 0;
      return { state, ruleset, target, command: { type: 'ATTACK_TARGET' as const, targetId: target.targetId, combatAssistCardId: meguminId } };
    };

    const choice = prepare('choice');
    expect(getLegalCommands(choice.state, choice.ruleset, 'p1')).toContainEqual(choice.command);
    const suspended = dispatch(choice.state, choice.ruleset, envelope(choice.state, 'p1', choice.command, 'mage-06-choice-root'));
    expect(suspended.error).toBeUndefined();
    const restored = restoreSnapshot(serializeSnapshot(suspended.state), choice.ruleset);
    expect(getLegalCommands(restored, choice.ruleset, 'p1')).toEqual([expect.objectContaining({ type: 'RESOLVE_EFFECT_CHOICE', optionId: 'boost' })]);
    const completed = dispatch(restored, choice.ruleset, envelope(restored, 'p1', getLegalCommands(restored, choice.ruleset, 'p1')[0]!, 'mage-06-choice-boost'));
    expect(completed.error).toBeUndefined(); expect(completed.state.removedCards).toContain(choice.command.combatAssistCardId);

    const random = prepare('random');
    expect(getLegalCommands(random.state, random.ruleset, 'p1')).toContainEqual(random.command);
    const randomized = dispatch(random.state, random.ruleset, envelope(random.state, 'p1', random.command, 'mage-06-random-root'));
    expect(randomized.error).toBeUndefined(); expect(randomized.state.removedCards).toContain(random.command.combatAssistCardId);
  });

  it('gives custom tank 06 its exact public monster-combat tier after all target modifiers', () => {
    const expected = new Map([[0, 0], [1, 1], [5, 1], [6, 2], [6.5, 2], [10, 2], [11, 3]]);
    for (const [total, bonus] of expected) {
      const { state, ruleset } = customGame();
      const darknessId = replaceParty(state, ['custom:adventurer/tank-06'])[0]!;
      const monsters = Object.values(state.enemyTargets).filter(({ kind, status }) => kind === 'monster' && status === 'available');
      const fractional = !Number.isInteger(total);
      const totalBeforeContinuousModifier = total - (fractional ? monsters.length * 0.5 : 0);
      state.temporaryTargetModifiers = monsters.map((target, index) => {
        const combat = evaluateCombat(state, ruleset, 'p1', target.targetId);
        if (combat.status !== 'ready') throw new Error(combat.error);
        return {
          modifierId: `darkness-tier-${total}-${index}`,
          moduleId: customAdventurerRulesModuleId,
          targetCardId: target.cardInstanceId,
          amount: (index === 0 ? totalBeforeContinuousModifier : 0) - combat.evaluation.requiredCombat,
          expiresAtTurnEndPlayerId: 'p1',
        };
      });
      const fractionalModule = {
        id: 'test:fractional-public-enemy-combat', version: '1',
        getPartyLimit: (_state: typeof state, _player: typeof state.players[number], limit: number) => limit,
        onSupplyDepleted: () => 'handled' as const,
        continuousRules: [{ schemaVersion: 1 as const, effectId: 'fractional-enemy-combat', moduleId: 'test:fractional-public-enemy-combat', sourceCardId: darknessId, duration: 'while-source-present' as const, priority: 1, target: 'combat-modifier' as const, amount: 0.5 }],
      };
      const activeRuleset = fractional
        ? createRuleset([baseProvisionalOriginalFullContentPack, customAdventurerContentPack], [baseRulesModule, customAdventurerRulesModule, fractionalModule], { allowProvisionalPlaytest: true })
        : ruleset;
      if (fractional) {
        const existingIdentities = new Map(state.rulesModules.map((identity) => [identity.id, identity]));
        state.rulesModules = activeRuleset.modules.map(({ id, version }) => structuredClone(existingIdentities.get(id) ?? { id, version }));
        state.moduleState[fractionalModule.id] = {};
      }
      const evaluation = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: 'p1' });
      expect(evaluation, JSON.stringify(evaluation)).toMatchObject({ status: 'ready', evaluation: { members: [{
        adventurerId: darknessId,
        modifierCombat: bonus,
        effectiveCombat: 1 + bonus,
        appliedRules: [expect.objectContaining({ ruleId: 'custom-tank-06-public-monster-combat-tier', amount: bonus })],
      }] } });
      expect(getCpuActionFeatures(state, activeRuleset, 'p1')).toEqual(getCpuActionFeatures(restoreSnapshot(serializeSnapshot(state), activeRuleset), activeRuleset, 'p1'));
    }
  });

  it('lets custom tank 07 preserve itself and all attachments once per controller turn', () => {
    const { state, ruleset } = customGame();
    const yunyunId = replaceParty(state, ['custom:adventurer/tank-07'])[0]!;
    const equipmentId = takeCard(state, 'base:resource/resource-09');
    state.players[0]!.party[0]!.equipmentIds = [equipmentId];
    state.cards[equipmentId]!.ownerId = 'p1';
    state.phase = 'combat';
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!;
    const combat = evaluateCombat(state, ruleset, 'p1', target.targetId);
    if (combat.status !== 'ready') throw new Error(combat.error);
    state.players[0]!.turnCombatBonus = Math.max(0, combat.evaluation.requiredCombat - 1);

    const attackFeature = getCpuActionFeatures(state, ruleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === target.targetId && !command.combatAssistCardId);
    expect(attackFeature).toMatchObject({ partyCombatLoss: 0, equipmentLoss: 0, equipmentRemoval: 0 });

    const attacked = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: target.targetId }, 'custom-tank-07-attack'));
    expect(attacked.error).toBeUndefined();
    expect(attacked.state.effectState.pendingCommand?.kind).toBe('combat-departure-choice');
    const restored = restoreSnapshot(serializeSnapshot(attacked.state), ruleset);
    const continuation = restored.effectState.pendingCommand;
    if (continuation?.kind !== 'combat-departure-choice') throw new Error('Expected combat departure choice.');
    const keepOptionId = Object.entries(continuation.optionCandidateIds).find(([, ids]) => ids.includes(yunyunId))?.[0];
    expect(projectPlayerView(restored, ruleset, 'p1').decisionPrompt?.options).toContainEqual(expect.objectContaining({ id: keepOptionId, selectedCardIds: [yunyunId], selectedDefinitionIds: ['custom:adventurer/tank-07'] }));
    const command = getLegalCommands(restored, ruleset, 'p1').find((candidate) => candidate.type === 'RESOLVE_EFFECT_CHOICE' && candidate.optionId === keepOptionId);
    if (!command) throw new Error('Expected Yunyun keep choice.');
    const kept = dispatch(restored, ruleset, envelope(restored, 'p1', command, 'custom-tank-07-keep'));
    expect(kept.error).toBeUndefined();
    expect(kept.state.players[0]!.party).toContainEqual({ adventurerId: yunyunId, equipmentIds: [equipmentId] });
    expect(kept.state.turnFacts?.effectUses?.['custom:tank-07-stay-after-combat']).toBe(1);
    expect(kept.state.turnFacts).toMatchObject({
      lastCombatParticipantCount: 1,
      lastCombatDiscardedEquipment: 0,
      lastCombatDiscardedNonStarterProfessions: [],
    });
    expect(kept.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'COMBAT_DEPARTURE_REPLACED' })]));

    const nextTarget = Object.values(kept.state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!;
    const participantDeparture = evaluateCombatParticipantDeparture(kept.state, ruleset, {
      schemaVersion: 1, playerId: 'p1', targetId: nextTarget.targetId, participantCardIds: [yunyunId],
    });
    if (participantDeparture.status !== 'ready') throw new Error(participantDeparture.error);
    expect(evaluateCombatDepartureReplacements(kept.state, ruleset, 'p1', participantDeparture.evaluation)).toMatchObject({ status: 'ready', candidates: [] });
    const nextTurn = structuredClone(kept.state);
    nextTurn.turnFacts!.effectUses = {};
    expect(evaluateCombatDepartureReplacements(nextTurn, ruleset, 'p1', participantDeparture.evaluation)).toMatchObject({
      status: 'ready', candidates: [expect.objectContaining({ adventurerId: yunyunId, replacement: { kind: 'keep-self-in-party' } })],
    });
  });

  it('offers only shared-quota-safe departure choices and keeps Legal Commands aligned with dispatch', () => {
    const { state, ruleset } = customGame();
    const yunyunId = replaceParty(state, ['custom:adventurer/tank-07'])[0]!;
    const secondYunyunId = `${yunyunId}:quota-copy`;
    state.cards[secondYunyunId] = { ...structuredClone(state.cards[yunyunId]!), id: secondYunyunId, ownerId: 'p1' };
    state.players[0]!.party.push({ adventurerId: secondYunyunId });
    state.phase = 'combat';
    const target = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'monster' && status === 'available')!;
    const party = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: target.targetId });
    if (party.status !== 'ready') throw new Error(party.error);
    const requiredCombat = party.evaluation.members.reduce((total, member) => total + member.effectiveCombat, 0);
    const combat = evaluateCombat(state, ruleset, 'p1', target.targetId);
    if (combat.status !== 'ready') throw new Error(combat.error);
    state.temporaryTargetModifiers = [{ modifierId: 'shared-quota-require-both', moduleId: customAdventurerRulesModuleId, targetCardId: target.cardInstanceId, amount: requiredCombat - combat.evaluation.requiredCombat, expiresAtTurnEndPlayerId: 'p1' }];
    state.players[0]!.turnCombatBonus = 0;

    expect(getCpuActionFeatures(state, ruleset, 'p1').find(({ command }) => command.type === 'ATTACK_TARGET' && command.targetId === target.targetId)).toMatchObject({ partyCombatLoss: 1 });
    const attacked = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: target.targetId }, 'shared-quota-attack'));
    expect(attacked.error).toBeUndefined();
    const restored = restoreSnapshot(serializeSnapshot(attacked.state), ruleset);
    const pending = restored.effectState.pendingCommand;
    if (pending?.kind !== 'combat-departure-choice') throw new Error('Expected shared-quota departure choice.');
    expect(Object.values(pending.optionCandidateIds)).toEqual([[], [yunyunId], [secondYunyunId]]);
    expect(Object.values(pending.optionCandidateIds)).not.toContainEqual([yunyunId, secondYunyunId]);

    const legal = getLegalCommands(restored, ruleset, 'p1');
    expect(legal).toHaveLength(3);
    const keepOne = legal.find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'departure-2');
    if (!keepOne) throw new Error('Expected the last shared-quota-safe option.');
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', keepOne, 'shared-quota-keep-one'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.party.map(({ adventurerId }) => adventurerId)).toEqual([secondYunyunId]);
    expect(completed.state.turnFacts?.effectUses?.['custom:tank-07-stay-after-combat']).toBe(1);
  });

  it('lets custom support 09 rotate the active helper to the deck bottom and run the new entry state', () => {
    const { state, ruleset } = customHelperGame();
    const previousActive = state.zones[baseHelperZoneIds.active]!.cardIds[0]!;
    const deck = state.zones[baseHelperZoneIds.deck]!.cardIds;
    const nextActive = deck.at(-1)!;

    const junaId = takeCard(state, 'custom:adventurer/support-09');
    state.players[0]!.hand.push(junaId); state.cards[junaId]!.ownerId = 'p1'; state.phase = 'action1';
    const played = dispatch(state, ruleset, envelope(state, 'p1', { type: 'PLAY_ADVENTURER', cardId: junaId }, 'custom-support-09-play'));
    expect(played.error).toBeUndefined();
    expect(played.state.effectState.pendingChoice).toMatchObject({ choiceId: 'custom:adventurer/support-09-rotate-helper' });
    const restored = restoreSnapshot(serializeSnapshot(played.state), ruleset);
    const rotate = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === 'rotate');
    if (!rotate) throw new Error('Expected helper rotation choice.');
    const rotated = dispatch(restored, ruleset, envelope(restored, 'p1', rotate, 'custom-support-09-rotate'));
    expect(rotated.error).toBeUndefined();
    expect(rotated.state.zones[baseHelperZoneIds.active]!.cardIds).toEqual([nextActive]);
    expect(rotated.state.zones[baseHelperZoneIds.deck]!.cardIds[0]).toBe(previousActive);
    expect(rotated.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'SUPPLY_ROW_REFRESHED' })]));
    expect(restoreSnapshot(serializeSnapshot(rotated.state), ruleset)).toEqual(rotated.state);
  });

  it('does not offer custom support 09 a meaningless rotation when no helper remains in the deck', () => {
    const { state, ruleset } = customHelperGame();
    state.zones[baseHelperZoneIds.retired]!.cardIds.push(...state.zones[baseHelperZoneIds.deck]!.cardIds.splice(0));
    const junaId = takeCard(state, 'custom:adventurer/support-09');
    state.players[0]!.hand.push(junaId); state.cards[junaId]!.ownerId = 'p1'; state.phase = 'action1';
    const played = dispatch(state, ruleset, envelope(state, 'p1', { type: 'PLAY_ADVENTURER', cardId: junaId }, 'custom-support-09-no-deck'));
    expect(played.error).toBeUndefined();
    expect(played.state.effectState.pendingChoice).toBeUndefined();
    expect(played.state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(1);
  });

  it('applies the three-member profession aura only to matching party members and survives Snapshot restore', () => {
    const { state, ruleset } = customGame();
    replaceParty(state, [
      'custom:adventurer/mage-07',
      'custom:starter/mage',
      'custom:adventurer/mage-01',
      'custom:starter/support',
    ]);
    const mageEvaluation = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1' });
    expect(mageEvaluation.status).toBe('ready');
    if (mageEvaluation.status !== 'ready') throw new Error(mageEvaluation.error);
    expect(mageEvaluation.evaluation.members.map(({ modifierCombat }) => modifierCombat)).toEqual([2, 2, 2, 0]);

    replaceParty(state, [
      'custom:adventurer/tank-09',
      'custom:starter/tank',
      'custom:adventurer/tank-01',
      'custom:starter/support',
    ]);
    const tankEvaluation = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1' });
    expect(tankEvaluation.status).toBe('ready');
    if (tankEvaluation.status !== 'ready') throw new Error(tankEvaluation.error);
    expect(tankEvaluation.evaluation.members.map(({ modifierCombat }) => modifierCombat)).toEqual([4, 2, 2, 0]);
    expect(tankEvaluation.evaluation.members.slice(0, 3).every(({ appliedRules }) =>
      appliedRules.filter(({ ruleId }) => ruleId === 'custom-tank-09-three-tank-aura').length === 1
    )).toBe(true);
    expect(tankEvaluation.evaluation.members[3]!.appliedRules.some(({ ruleId }) => ruleId === 'custom-tank-09-three-tank-aura')).toBe(false);

    const restored = restoreSnapshot(serializeSnapshot(state), ruleset);
    expect(evaluatePartyCombat(restored, ruleset, { schemaVersion: 1, playerId: 'p1' })).toEqual(tankEvaluation);

    replaceParty(state, ['custom:adventurer/tank-09', 'custom:starter/tank']);
    const belowThreshold = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1' });
    expect(belowThreshold.status === 'ready' ? belowThreshold.evaluation.members.map(({ modifierCombat }) => modifierCombat) : []).toEqual([0, 0]);
  });

  it('creates and restores a four-player custom ruleset with exact registry identity', () => {
    const ruleset = createRuleset(
      [baseProvisionalOriginalFullContentPack, customAdventurerContentPack],
      [baseRulesModule, customAdventurerRulesModule],
      { allowProvisionalPlaytest: true },
    );
    const state = createGame({
      gameId: 'custom-rules',
      seed: 29,
      players: Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, kind: index === 0 ? 'human' as const : 'ai' as const })),
    }, ruleset);
    expect(restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset)).toEqual(state);
  });

  it('rolls and applies custom melee 07 combat multiplier at combat phase start', () => {
    const { state, ruleset } = customGame();
    replaceParty(state, ['custom:adventurer/melee-07']);
    state.phase = 'action1';
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'custom-melee-07-combat-start'));
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('combat');
    const multiplier = result.state.turnFacts?.partyCombatMultipliers?.find(({ definitionId }) => definitionId === 'custom:adventurer/melee-07');
    expect(multiplier).toBeDefined();
    const combat = evaluatePartyCombat(result.state, ruleset, { schemaVersion: 1, playerId: 'p1' });
    expect(combat.status === 'ready' ? combat.evaluation.members[0]?.effectiveCombat : undefined).toBe(Math.floor((multiplier!.numerator / multiplier!.denominator)));
    expect(restoreSnapshot(serializeSnapshot(result.state), ruleset)).toEqual(result.state);
  });

  it('inherits the confirmed odd-roll plus-one effect for custom mage 02', () => {
    const { state, ruleset } = customGame();
    replaceParty(state, ['custom:adventurer/mage-02']);
    state.phase = 'action1';
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'custom-mage-02-combat-start'));
    expect(result.error).toBeUndefined(); expect(result.state.phase).toBe('combat');
    const roll = result.events.find((event) => event.type === 'DIE_ROLLED' && JSON.stringify(event.payload).includes('adventurer-03-combat-d6'));
    const face = Number((roll?.payload as { evaluation?: { face?: number } } | undefined)?.evaluation?.face);
    expect(result.state.players[0]!.turnCombatBonus).toBe(0);
    expect(evaluatePartyCombat(result.state, ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({
      status: 'ready', evaluation: { members: [{ effectiveCombat: 3 + (face % 2 === 1 ? 1 : 0) }] },
    });
    expect(restoreSnapshot(serializeSnapshot(result.state), ruleset)).toEqual(result.state);
  });

  it('lets custom support 06 reorder the whole party through a Snapshot-safe ordering choice', () => {
    const { state, ruleset } = customGame();
    const [firstId] = replaceParty(state, ['custom:starter/melee']);
    const supportId = takeCard(state, 'custom:adventurer/support-06');
    state.players[0]!.hand.push(supportId); state.cards[supportId]!.ownerId = 'p1'; state.phase = 'action1';
    const played = dispatch(state, ruleset, envelope(state, 'p1', { type: 'PLAY_ADVENTURER', cardId: supportId }, 'custom-support-06-play'));
    expect(played.error).toBeUndefined(); expect(played.state.effectState.pendingChoice?.order?.kind).toBe('party');
    const restored = restoreSnapshot(serializeSnapshot(played.state), ruleset);
    const reverse = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_ORDER' && command.orderedCardIds[0] === supportId)!;
    const reordered = dispatch(restored, ruleset, envelope(restored, 'p1', reverse, 'custom-support-06-reorder'));
    expect(reordered.error).toBeUndefined(); expect(reordered.state.players[0]!.party.map(({ adventurerId }) => adventurerId)).toEqual([supportId, firstId]);
  });

  it('adds custom ranged 03 combat from reserve without consuming its slot', () => {
    const { state, ruleset } = customGame();
    replaceParty(state, ['custom:starter/ranged', 'custom:adventurer/ranged-03']);
    state.phase = 'combat'; state.players[0]!.turnCombatBonus = 0;
    expect(evaluateCombatPartyPrefix(state, ruleset, 'p1', 2)).toMatchObject({ slotCount: 1, power: 2 });
    expect(evaluateCombatPartyPrefix(state, ruleset, 'p1', 3)).toBeUndefined();
  });

  it('uses one selected item once and resolves its effect twice with nested Snapshot continuation', () => {
    const { state, ruleset } = customGame(); const player = state.players[0]!;
    replaceParty(state, ['custom:starter/ranged']);
    const rangedId = takeCard(state, 'custom:adventurer/ranged-05');
    const itemId = takeCard(state, 'base:resource/resource-01');
    const firstDiscard = takeCard(state, 'custom:adventurer/tank-09');
    const secondDiscard = takeCard(state, 'custom:adventurer/tank-10');
    player.hand.push(rangedId, itemId); player.discardPile.push(firstDiscard, secondDiscard);
    for (const cardId of [rangedId, itemId, firstDiscard, secondDiscard]) state.cards[cardId]!.ownerId = player.id;
    state.phase = 'action1';
    const played = dispatch(state, ruleset, envelope(state, player.id, { type: 'PLAY_ADVENTURER', cardId: rangedId }, 'custom-ranged-05-play'));
    expect(played.error).toBeUndefined();
    const useItem = getLegalCommands(played.state, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === itemId)!;
    const firstChoice = dispatch(played.state, ruleset, envelope(played.state, player.id, useItem, 'custom-ranged-05-use-item'));
    expect(firstChoice.error).toBeUndefined(); expect(firstChoice.state.effectState.pendingChoice?.choiceId).toBe('base:resource/resource-01-recover-adventurer');
    const restoredFirst = restoreSnapshot(serializeSnapshot(firstChoice.state), ruleset);
    const recoverFirst = getLegalCommands(restoredFirst, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === firstDiscard)!;
    const secondChoice = dispatch(restoredFirst, ruleset, envelope(restoredFirst, player.id, recoverFirst, 'custom-ranged-05-first-recover'));
    expect(secondChoice.error).toBeUndefined(); expect(secondChoice.state.effectState.pendingChoice?.choiceId).toBe('base:resource/resource-01-recover-adventurer');
    const restoredSecond = restoreSnapshot(serializeSnapshot(secondChoice.state), ruleset);
    const recoverSecond = getLegalCommands(restoredSecond, ruleset, player.id).find((command) => command.type === 'RESOLVE_EFFECT_CHOICE' && command.optionId === secondDiscard)!;
    const completed = dispatch(restoredSecond, ruleset, envelope(restoredSecond, player.id, recoverSecond, 'custom-ranged-05-second-recover'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.players[0]!.playArea.filter((cardId) => cardId === itemId)).toHaveLength(1);
    expect(completed.state.players[0]!.hand).toEqual(expect.arrayContaining([firstDiscard, secondDiscard]));
    expect(completed.state.turnFacts?.itemsUsed).toBe(1);
  });
});
