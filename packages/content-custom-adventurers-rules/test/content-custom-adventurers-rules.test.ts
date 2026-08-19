import { describe, expect, it } from 'vitest';
import { baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base/runtime';
import { customAdventurerCapabilityMatrix, customAdventurerContentPack, customAdventurerRulesModuleId } from '@guildmaster/content-custom-adventurers';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateCombatPartyPrefix, evaluatePartyCombat, getLegalCommands, restoreSnapshot, serializeSnapshot } from '@guildmaster/game-engine';
import { customAdventurerRulesModule } from '../src/index.js';

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
    ]);
    const serializedRules = JSON.stringify(customAdventurerRulesModule);
    for (const { contentId } of customAdventurerCapabilityMatrix.filter(({ effectStatus }) => effectStatus === 'blocked')) {
      expect(serializedRules).not.toContain(contentId);
    }
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
