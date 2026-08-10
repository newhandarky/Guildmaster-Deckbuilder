import { ActionPreviewItemSchema, type GameState } from '@guildmaster/game-protocol';
import { describe, expect, it } from 'vitest';
import { baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluatePurchaseCost, evaluateRestHandSize, getActionPreviewSet, getLegalCommands, getPurchasePower, type RulesModule } from '../src/index.js';
import { createCard } from '../src/model/factories.js';
import { testPack, testRuleset } from './fixtures.js';

const moduleId = 'test:purchase-rest';
const itemRowId = 'base:item-row';

function modifierModule(extraDiscount = false): RulesModule {
  return {
    id: moduleId,
    version: '1.0.0',
    getPartyLimit: (_state, _player, limit) => limit,
    onSupplyDepleted: () => 'handled',
    purchaseCostModifierRules: [
      {
        schemaVersion: 1,
        ruleId: 'test:supply-discount',
        moduleId,
        priority: 10,
        activation: { kind: 'definition-in-zone', zoneId: itemRowId, definitionId: 'test:item/ration' },
        target: { kind: 'definition-type-in', values: ['item', 'equipment'] },
        amount: -1,
      },
      ...(extraDiscount ? [{
        schemaVersion: 1 as const,
        ruleId: 'test:floor-discount',
        moduleId,
        priority: 20,
        activation: { kind: 'definition-in-zone' as const, zoneId: itemRowId, definitionId: 'test:item/ration' },
        target: { kind: 'definition-type-in' as const, values: ['item'] },
        amount: -9,
      }] : []),
    ],
    restHandSizePolicies: [{
      schemaVersion: 1,
      policyId: 'test:rest-six',
      moduleId,
      priority: 10,
      activation: { kind: 'definition-in-zone', zoneId: itemRowId, definitionId: 'test:item/ration' },
      playerScope: 'active-player',
      mode: 'replace',
      handSize: 6,
    }],
  };
}

function game(ruleset = createRuleset([testPack], [baseRulesModule, modifierModule()])): GameState {
  return createGame({ gameId: 'purchase-rest', seed: 41, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, ruleset);
}

function placeInItemRow(state: GameState, definitionId: string): string {
  const row = state.zones[itemRowId]!;
  const cardId = Object.values(state.cards).find((card) => card.definitionId === definitionId)!.id;
  const source = Object.values(state.zones).find((zone) => zone.cardIds.includes(cardId));
  if (!source) throw new Error(`Card ${cardId} is not in a shared zone.`);
  if (source.zoneId === row.zoneId) return cardId;
  source.cardIds.splice(source.cardIds.indexOf(cardId), 1);
  const displaced = row.cardIds.pop();
  if (displaced) source.cardIds.push(displaced);
  row.cardIds.push(cardId);
  return cardId;
}

describe('purchase-cost and rest-hand-size evaluators', () => {
  it('is pure, applies active modifiers in priority order, and floors cost at zero', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, modifierModule(true)]);
    const state = game(ruleset);
    const cardId = placeInItemRow(state, 'test:item/ration');
    const before = structuredClone(state);
    const result = evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: 'p1', cardId });

    expect(result).toMatchObject({
      status: 'ready',
      evaluation: {
        printedCost: 2,
        effectiveCost: 0,
        appliedModifiers: [
          { moduleId, ruleId: 'test:supply-discount', amount: -1 },
          { moduleId, ruleId: 'test:floor-discount', amount: -9 },
        ],
      },
    });
    expect(state).toEqual(before);
  });

  it('fails closed for registry, player, card, and authoritative activation errors', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, modifierModule()]);
    const state = game(ruleset);
    const cardId = placeInItemRow(state, 'test:item/ration');
    expect(evaluatePurchaseCost(state, testRuleset, { schemaVersion: 1, playerId: 'p1', cardId })).toMatchObject({ status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH' });
    expect(evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: 'missing', cardId })).toMatchObject({ status: 'failed', reason: 'UNKNOWN_PLAYER' });
    expect(evaluatePurchaseCost(state, ruleset, { schemaVersion: 1, playerId: 'p1', cardId: 'missing' })).toMatchObject({ status: 'failed', reason: 'UNKNOWN_CARD' });
    state.zones[itemRowId]!.visibility = 'hidden';
    expect(evaluateRestHandSize(state, ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({ status: 'failed', reason: 'INVALID_ACTIVATION' });
  });

  it('uses the same effective cost for legal commands, preview, dispatch, and spent power', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, modifierModule()]);
    const state = game(ruleset);
    placeInItemRow(state, 'test:item/ration');
    const cardId = placeInItemRow(state, 'test:item/spear');
    state.phase = 'purchase';
    const player = state.players[0]!;
    const available = getPurchasePower(state, ruleset, player.id);
    player.turnPurchaseSpent = available - 1;
    const spentBefore = player.turnPurchaseSpent;

    expect(getLegalCommands(state, ruleset, player.id)).toContainEqual({ type: 'BUY_CARD', cardId });
    expect(getActionPreviewSet(state, ruleset, player.id).items).toContainEqual({
      kind: 'purchase', status: 'ready', command: { type: 'BUY_CARD', cardId }, cardId,
      printedCost: 2, effectiveCost: 1,
      appliedModifiers: [{ moduleId, ruleId: 'test:supply-discount', amount: -1 }],
      availablePurchasePower: 1, remainingPurchasePower: 0,
    });
    const result = dispatch(state, ruleset, envelope(state, player.id, { type: 'BUY_CARD', cardId }, 'discounted-purchase'));
    expect(result.error).toBeUndefined();
    expect(result.state.players[0]!.turnPurchaseSpent).toBe(spentBefore + 1);
    expect(ruleset.registry.definitions['test:item/spear']!.cost).toBe(2);
  });

  it('draws the evaluated hand size at rest and retains the base size without a policy', () => {
    const ruleset = createRuleset([testPack], [baseRulesModule, modifierModule()]);
    const active = game(ruleset);
    placeInItemRow(active, 'test:item/ration');
    active.players[0]!.discardPile.push(createCard(active, 'test:starter/stone', 'p1').id);
    active.phase = 'rest';
    expect(evaluateRestHandSize(active, ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({ status: 'ready', evaluation: { baseHandSize: 5, effectiveHandSize: 6, appliedPolicy: { moduleId, policyId: 'test:rest-six' } } });
    const six = dispatch(active, ruleset, envelope(active, 'p1', { type: 'END_PHASE', phase: 'rest' }, 'rest-six'));
    expect(six.error).toBeUndefined();
    expect(six.state.players[0]!.hand).toHaveLength(6);

    const base = game(testRuleset);
    base.phase = 'rest';
    const five = dispatch(base, testRuleset, envelope(base, 'p1', { type: 'END_PHASE', phase: 'rest' }, 'rest-five'));
    expect(five.error).toBeUndefined();
    expect(five.state.players[0]!.hand).toHaveLength(5);
  });

  it('rejects a purchase preview whose modifiers do not reproduce its effective cost', () => {
    expect(ActionPreviewItemSchema.safeParse({
      kind: 'purchase', status: 'ready', command: { type: 'BUY_CARD', cardId: 'card-1' }, cardId: 'card-1',
      printedCost: 2, effectiveCost: 2,
      appliedModifiers: [{ moduleId: 'test:module', ruleId: 'test:discount', amount: -1 }],
      availablePurchasePower: 2, remainingPurchasePower: 0,
    }).success).toBe(false);
  });
});
