import { describe, expect, it } from 'vitest';
import { baseProvisionalContentCatalog, baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import {
  baseRulesModule,
  createGame,
  createRuleset,
  dispatch,
  envelope,
  evaluatePurchaseCost,
  evaluateRestHandSize,
  getActionPreviewSet,
  getLegalCommands,
  getPartyLimit,
  getPurchasePower,
  type Ruleset,
} from '@guildmaster/game-engine';
import {
  baseHelperIds,
  baseHelpersRulesModule,
  baseHelperZoneIds,
  baseProvisionalHelpersContentPack,
  enabledBaseHelperDefinitionIds,
  enabledBaseHelperDefinitionId,
} from '../src/index.js';

function helperRuleset(): Ruleset {
  return createRuleset(
    [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
    [baseRulesModule, baseHelpersRulesModule],
    { allowProvisionalPlaytest: true },
  );
}

function gameWithActiveHelper(ruleset: Ruleset, definitionId: string) {
  for (let seed = 1; seed <= 512; seed += 1) {
    const state = createGame({ gameId: `active-${definitionId}-${seed}`, seed, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
    const active = state.zones[baseHelperZoneIds.active]!.cardIds;
    const deck = state.zones[baseHelperZoneIds.deck]!.cardIds;
    const selected = [...active, ...deck];
    const desired = selected.find((cardId) => state.cards[cardId]!.definitionId === definitionId);
    if (!desired) continue;
    if (active[0] !== desired) {
      const current = active[0]!;
      deck.splice(deck.indexOf(desired), 1, current);
      active[0] = desired;
    }
    return state;
  }
  throw new Error(`A deterministic seed must select ${definitionId} within the test budget.`);
}

describe('provisional helper content extension', () => {
  it('publishes twelve neutral helper definitions with Batch A enabled', () => {
    expect(baseProvisionalContentCatalog.candidates
      .filter(({ category }) => category === 'helper')
      .map(({ definitionId }) => definitionId)).toEqual(baseHelperIds);
    expect(baseProvisionalHelpersContentPack.manifest).toMatchObject({
      id: 'base:provisional-helpers',
      role: 'expansion',
      contentStatus: 'provisional-playtest',
      dependencies: [baseProvisionalFoundationContentPack.manifest.id],
    });
    expect(baseProvisionalHelpersContentPack.definitions.map(({ id }) => id)).toEqual(baseHelperIds);
    expect(baseProvisionalHelpersContentPack.definitions).toHaveLength(12);
    expect(baseProvisionalHelpersContentPack.definitions.every(({ name, type, copies, tags }) =>
      /^候選協助者 \d{2}$/.test(name) && type === 'helper' && copies === 1 && tags?.includes('playtest:helper'))).toBe(true);
    expect(baseProvisionalHelpersContentPack.manifest).toMatchObject({ version: '0.2.0' });
    expect(baseHelpersRulesModule.version).toBe('1.1.0');
    expect(baseProvisionalHelpersContentPack.definitions.filter(({ tags }) => tags?.includes('playtest:effect-enabled')).map(({ id }) => id))
      .toEqual(enabledBaseHelperDefinitionIds);
    expect(baseProvisionalHelpersContentPack.definitions.filter(({ id }) => !enabledBaseHelperDefinitionIds.includes(id as (typeof enabledBaseHelperDefinitionIds)[number]))
      .every(({ tags }) => tags?.includes('playtest:effects-disabled'))).toBe(true);
  });

  it('composes with the unchanged foundation and creates one hidden helper per selected boss', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    const state = createGame({ gameId: 'base-helper-content', seed: 97, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    expect(state.moduleState['base:helpers']).toEqual({ schemaVersion: 1 });
    expect(state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(1);
    expect(state.zones[baseHelperZoneIds.deck]!.cardIds).toHaveLength(3);
    expect(state.zones[baseHelperZoneIds.retired]!.cardIds).toEqual([]);
    expect(baseProvisionalFoundationContentPack.definitions).toHaveLength(34);
  });

  it('maps helper 01, 06, and 09 to only their declared purchase types without changing printed cost', () => {
    const ruleset = helperRuleset();
    const cases = [
      ['base:helper/helper-01', 'base:resource/resource-01', 2, 3],
      ['base:helper/helper-01', 'base:resource/resource-02', 2, 3],
      ['base:helper/helper-01', 'base:adventurer/adventurer-01', 4, 4],
      ['base:helper/helper-06', 'base:adventurer/adventurer-01', 3, 4],
      ['base:helper/helper-06', 'base:resource/resource-01', 3, 3],
      ['base:helper/helper-09', 'base:resource/resource-02', 2, 3],
      ['base:helper/helper-09', 'base:resource/resource-01', 3, 3],
    ] as const;
    for (const [helperId, cardDefinitionId, effectiveCost, printedCost] of cases) {
      const state = gameWithActiveHelper(ruleset, helperId);
      const cardId = Object.values(state.cards).find(({ definitionId }) => definitionId === cardDefinitionId)!.id;
      expect(evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: 'p1', cardId })).toMatchObject({
        status: 'ready', evaluation: { printedCost, effectiveCost },
      });
      expect(ruleset.registry.definitions[cardDefinitionId]!.cost).toBe(printedCost);
    }
  });

  it('uses helper 01 consistently across legal purchase commands, preview, and authoritative spent power', () => {
    const ruleset = helperRuleset();
    const state = gameWithActiveHelper(ruleset, 'base:helper/helper-01');
    state.phase = 'purchase';
    const cardId = state.zones['base:item-row']!.cardIds[0]!;
    const printedCost = ruleset.registry.definitions[state.cards[cardId]!.definitionId]!.cost!;
    const available = getPurchasePower(state, ruleset, 'p1');
    state.players[0]!.turnPurchaseSpent = available - Math.max(0, printedCost - 1);
    const spentBefore = state.players[0]!.turnPurchaseSpent;
    expect(getLegalCommands(state, ruleset, 'p1')).toContainEqual({ type: 'BUY_CARD', cardId });
    expect(getActionPreviewSet(state, ruleset, 'p1').items).toContainEqual(expect.objectContaining({
      kind: 'purchase', status: 'ready', cardId, printedCost, effectiveCost: Math.max(0, printedCost - 1),
      appliedModifiers: [{ moduleId: 'base:helpers', ruleId: 'base:helper-01-supply-discount', amount: -1 }],
    }));
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'BUY_CARD', cardId }, 'helper-01-purchase'));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.turnPurchaseSpent - spentBefore).toBe(Math.max(0, printedCost - 1));
  });

  it('draws six at rest only while helper 07 is active', () => {
    const ruleset = helperRuleset();
    for (const [helperId, expected] of [['base:helper/helper-07', 6], ['base:helper/helper-06', 5]] as const) {
      const state = gameWithActiveHelper(ruleset, helperId);
      const extra = state.zones['base:item-deck']!.cardIds.pop()!;
      state.players[0]!.discardPile.push(extra);
      state.phase = 'rest';
      expect(evaluateRestHandSize(state, ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({ status: 'ready', evaluation: { effectiveHandSize: expected } });
      const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'rest' }, `rest-${helperId}`));
      expect(result.error).toBeUndefined();
      expect(result.state.players[0]!.hand).toHaveLength(expected);
    }
  });

  it('switches purchase and rest evaluators immediately after a Boss rotates helper 01 to helper 07', () => {
    const ruleset = helperRuleset();
    let state: ReturnType<typeof createGame> | undefined;
    for (let seed = 1; seed <= 512; seed += 1) {
      const candidate = createGame({ gameId: `batch-a-rotation-${seed}`, seed, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
      const selectedDefinitions = [...candidate.zones[baseHelperZoneIds.active]!.cardIds, ...candidate.zones[baseHelperZoneIds.deck]!.cardIds]
        .map((cardId) => candidate.cards[cardId]!.definitionId);
      if (selectedDefinitions.includes('base:helper/helper-01') && selectedDefinitions.includes('base:helper/helper-07')) { state = candidate; break; }
    }
    if (!state) throw new Error('A deterministic seed must select helpers 01 and 07 within the test budget.');
    const active = state.zones[baseHelperZoneIds.active]!.cardIds;
    const deck = state.zones[baseHelperZoneIds.deck]!.cardIds;
    const helper01 = [...active, ...deck].find((cardId) => state!.cards[cardId]!.definitionId === 'base:helper/helper-01')!;
    const helper07 = [...active, ...deck].find((cardId) => state!.cards[cardId]!.definitionId === 'base:helper/helper-07')!;
    if (active[0] !== helper01) {
      const current = active[0]!;
      deck.splice(deck.indexOf(helper01), 1, current);
      active[0] = helper01;
    }
    deck.splice(deck.indexOf(helper07), 1);
    deck.push(helper07);
    const cardId = state.zones['base:item-row']!.cardIds[0]!;
    const before = evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: 'p1', cardId });
    if (before.status !== 'ready') throw new Error(before.error);
    expect(before.evaluation.effectiveCost).toBe(before.evaluation.printedCost - 1);

    state.players[0]!.turnCombatBonus = 99;
    state.phase = 'combat';
    const boss = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const rotated = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: boss.targetId }, 'batch-a-rotate'));
    expect(rotated.error).toBeUndefined();
    const activeAfter = rotated.state.zones[baseHelperZoneIds.active]!.cardIds[0]!;
    expect(rotated.state.cards[activeAfter]!.definitionId).toBe('base:helper/helper-07');
    const after = evaluatePurchaseCost(rotated.state, ruleset, { schemaVersion: 1, playerId: 'p1', cardId });
    if (after.status !== 'ready') throw new Error(after.error);
    expect(after.evaluation.effectiveCost).toBe(after.evaluation.printedCost);
    expect(evaluateRestHandSize(rotated.state, ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({ status: 'ready', evaluation: { effectiveHandSize: 6 } });
  });

  it('runs equipment triggers before helper rotation and capacity enforcement', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    let state: ReturnType<typeof createGame> | undefined;
    for (let seed = 1; seed <= 256; seed += 1) {
      const candidate = createGame({
        gameId: `base-helper-order-${seed}`,
        seed,
        players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
        startingPlayerId: 'p1',
      }, ruleset);
      const selected = [
        ...candidate.zones[baseHelperZoneIds.active]!.cardIds,
        ...candidate.zones[baseHelperZoneIds.deck]!.cardIds,
      ];
      if (selected.some((cardId) => candidate.cards[cardId]!.definitionId === enabledBaseHelperDefinitionId)) {
        state = candidate;
        break;
      }
    }
    if (!state) throw new Error('A deterministic seed must select helper 08 within the test budget.');

    const active = state.zones[baseHelperZoneIds.active]!.cardIds;
    const helperDeck = state.zones[baseHelperZoneIds.deck]!.cardIds;
    const helper08 = [...active, ...helperDeck]
      .find((cardId) => state!.cards[cardId]!.definitionId === enabledBaseHelperDefinitionId)!;
    if (active[0] !== helper08) {
      const current = active[0]!;
      helperDeck.splice(helperDeck.indexOf(helper08), 1, current);
      active[0] = helper08;
    }
    const nextDisabled = helperDeck
      .findIndex((cardId) => state!.cards[cardId]!.definitionId !== enabledBaseHelperDefinitionId);
    helperDeck.push(...helperDeck.splice(nextDisabled, 1));

    const player = state.players[0]!;
    while (player.party.length < 6) {
      player.party.push({ adventurerId: state.zones['base:adventurer-deck']!.cardIds.pop()! });
    }
    const equipmentDefinitionId = 'base:resource/resource-18';
    const equipmentZone = ['base:item-row', 'base:item-deck']
      .map((zoneId) => state!.zones[zoneId]!)
      .find((zone) => zone.cardIds.some((cardId) => state!.cards[cardId]!.definitionId === equipmentDefinitionId));
    if (!equipmentZone) throw new Error('The foundation setup must contain resource 18.');
    const equipmentIndex = equipmentZone.cardIds
      .findIndex((cardId) => state!.cards[cardId]!.definitionId === equipmentDefinitionId);
    const [equipmentId] = equipmentZone.cardIds.splice(equipmentIndex, 1);
    if (!equipmentId) throw new Error('The resource 18 instance must be available.');
    const discardedMemberId = player.party.at(-1)!.adventurerId;
    player.party.at(-1)!.equipmentId = equipmentId;
    player.turnCombatBonus = 99;
    state.phase = 'combat';
    expect(getPartyLimit(ruleset, state, player)).toBe(6);

    const boss = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const result = dispatch(state, ruleset, envelope(
      state,
      'p1',
      { type: 'ATTACK_TARGET', targetId: boss.targetId },
      'base-helper-ordering',
    ));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.discardPile.slice(-2)).toEqual([discardedMemberId, equipmentId]);
    expect(getPartyLimit(ruleset, result.state, result.state.players[0]!)).toBe(5);
    const eventTypes = result.events.map(({ type }) => type);
    expect(eventTypes.indexOf('CARD_DRAWN')).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf('CARD_DRAWN')).toBeLessThan(eventTypes.indexOf('SUPPLY_ROW_REFRESHED'));
    expect(eventTypes.indexOf('SUPPLY_ROW_REFRESHED')).toBeLessThan(eventTypes.indexOf('PARTY_MEMBER_DISCARDED'));

  });

  it('refills each defeated boss and rotates helpers through the final boss', () => {
    const ruleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    let state = createGame({
      gameId: 'base-helper-all-bosses',
      seed: 131,
      players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }],
      startingPlayerId: 'p1',
    }, ruleset);
    const selectedCount = state.zones[baseHelperZoneIds.deck]!.cardIds.length
      + state.zones[baseHelperZoneIds.active]!.cardIds.length;
    for (let index = 0; index < selectedCount; index += 1) {
      state.players[0]!.turnCombatBonus = 99;
      state.phase = 'combat';
      const boss = Object.values(state.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available');
      if (!boss) throw new Error(`Boss ${index + 1} must be available after refill.`);
      const result = dispatch(state, ruleset, envelope(
        state,
        'p1',
        { type: 'ATTACK_TARGET', targetId: boss.targetId },
        `base-helper-boss-${index + 1}`,
      ));
      expect(result.error).toBeUndefined();
      state = result.state;
      expect(state.zones[baseHelperZoneIds.retired]!.cardIds).toHaveLength(index + 1);
      expect(state.zones[baseHelperZoneIds.active]!.cardIds).toHaveLength(index + 1 < selectedCount ? 1 : 0);
      expect(state.zones['base:boss-row']!.cardIds).toHaveLength(index + 1 < selectedCount ? 1 : 0);
    }
    expect(state.players[0]!.history.defeatedBosses).toBe(selectedCount);
    expect(state.zones['base:boss-deck']!.cardIds).toEqual([]);
    expect(evaluateRestHandSize(state, ruleset, { schemaVersion: 1, playerId: state.activePlayerId })).toMatchObject({ status: 'ready', evaluation: { effectiveHandSize: 5 } });
  });
});
