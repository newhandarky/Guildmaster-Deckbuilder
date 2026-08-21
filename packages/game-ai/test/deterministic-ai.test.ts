import { describe, expect, it } from 'vitest';
import type { CpuActionFeature, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import { CpuTurnRunner, baseBalancedCpuProfile, decideCpuAction } from '../src/index.js';

const view = (revision = 1) => ({ viewerId: 'cpu-1', gameId: 'g', status: 'playing', phase: 'purchase', round: 1, revision, activePlayerId: 'cpu-1' } as unknown as PlayerView);
const feature = (command: GameCommand, values: Partial<CpuActionFeature> = {}): CpuActionFeature => ({ schemaVersion: 1, command, honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, equipmentRemoval: 0, overflowLoss: 0, ...values });
const context = (legalCommands: GameCommand[], actionFeatures: CpuActionFeature[] = []) => ({ view: view(), legalCommands, actionFeatures, definitions: {}, rulesetFingerprint: 'rules', profile: baseBalancedCpuProfile });

describe('deterministic CPU strategy', () => {
  it('returns exactly the same command, score and fingerprint for identical input', () => {
    const buy = { type: 'BUY_CARD' as const, cardId: 'card-1' };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const input = context([buy, end], [feature(buy, { honorGain: 2, purchaseCost: 3 })]);
    const decisions = Array.from({ length: 100 }, () => decideCpuAction(input));
    expect(new Set(decisions.map((decision) => JSON.stringify(decision))).size).toBe(1);
    expect(decisions[0]).toMatchObject({ status: 'ready', command: buy, reasonCode: 'BUY_HIGHEST_UTILITY' });
  });

  it('keeps the five-bond combination with the greatest provisional honor', () => {
    const low = { type: 'SELECT_BONDS' as const, offerId: 'offer', bondIds: ['b1', 'b2', 'b3', 'b4', 'b5'] };
    const high = { type: 'SELECT_BONDS' as const, offerId: 'offer', bondIds: ['b3', 'b4', 'b5', 'b6', 'b7'] };
    const result = decideCpuAction({ ...context([low, high]), bonds: Array.from({ length: 7 }, (_, index) => ({ id: `b${index + 1}`, name: `B${index + 1}`, honor: index + 1, requiredBosses: 99 })) });
    expect(result).toMatchObject({ status: 'ready', command: high, reasonCode: 'KEEP_HIGHEST_BOND_VALUE' });
  });

  it('completes the eligible bond subset with the greatest public honor value', () => {
    const one = { type: 'COMPLETE_BONDS' as const, bondIds: ['b1'] };
    const both = { type: 'COMPLETE_BONDS' as const, bondIds: ['b1', 'b2'] };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const result = decideCpuAction(context([one, both, end], [feature(one, { bondHonorGain: 2 }), feature(both, { bondHonorGain: 7 })]));
    expect(result).toMatchObject({ status: 'ready', command: both, reasonCode: 'COMPLETE_ELIGIBLE_BONDS', score: 700 });
  });

  it('ends a phase when every optional action has no positive utility', () => {
    const refresh = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId: 'hand', refreshCardIds: ['row'] };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    expect(decideCpuAction(context([refresh, end], [feature(refresh)]))).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
  });

  it('ends combat when an authoritative failure gate removes all projected attack rewards', () => {
    const attack = { type: 'ATTACK_TARGET' as const, targetId: 'boss-target' };
    const end = { type: 'END_PHASE' as const, phase: 'combat' as const };
    const combatView = { ...view(), phase: 'combat', enemyTargets: { 'boss-target': { targetId: 'boss-target', cardInstanceId: 'boss-card', kind: 'boss', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({ ...context([attack, end], [feature(attack)]), view: combatView });
    expect(result).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
  });

  it('does not replace stronger equipment when the public feature reports a negative net change', () => {
    const equip = { type: 'EQUIP_ITEM' as const, cardId: 'weak-equipment', adventurerId: 'member' };
    const end = { type: 'END_PHASE' as const, phase: 'action1' as const };
    const actionView = { ...view(), phase: 'action1' } as PlayerView;
    const result = decideCpuAction({ ...context([equip, end], [feature(equip, { partyCombatGain: 2, partyCombatLoss: 4, equipmentLoss: 1 })]), view: actionView });
    expect(result).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
  });

  it('preserves its party when a public boss is available but not yet legally attackable', () => {
    const monsterAttack = { type: 'ATTACK_TARGET' as const, targetId: 'monster-target' };
    const end = { type: 'END_PHASE' as const, phase: 'combat' as const };
    const combatView = {
      ...view(), phase: 'combat',
      self: { turnCombatBonus: 0, history: { defeatedBosses: 0, defeatedMonsters: 10 }, party: [{ adventurerId: 'party-card' }] },
      cards: { 'party-card': { id: 'party-card', definitionId: 'party-def' }, 'boss-card': { id: 'boss-card', definitionId: 'boss-def' } },
      enemyTargets: {
        'boss-target': { targetId: 'boss-target', cardInstanceId: 'boss-card', kind: 'boss', status: 'available' },
        'monster-target': { targetId: 'monster-target', cardInstanceId: 'monster-card', kind: 'monster', status: 'available' },
      },
    } as unknown as PlayerView;
    const result = decideCpuAction({ ...context([monsterAttack, end], [feature(monsterAttack, { honorGain: 5, monsterDefeat: 1 })]), view: combatView, definitions: { 'party-def': { id: 'party-def', name: 'Party', type: 'adventurer', copies: 1, source: 'test', combat: 12 }, 'boss-def': { id: 'boss-def', name: 'Boss', type: 'boss', copies: 1, source: 'test', combat: 14 } } });
    expect(result).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
  });

  it('does not replace the actual discard-oldest member with a weaker incoming card', () => {
    const play = { type: 'PLAY_ADVENTURER' as const, cardId: 'incoming' };
    const end = { type: 'END_PHASE' as const, phase: 'action1' as const };
    const party = ['p1', 'p2', 'p3', 'p4', 'p5'].map((adventurerId) => ({ adventurerId }));
    const cards = Object.fromEntries([...party.map(({ adventurerId }) => [adventurerId, { id: adventurerId, definitionId: adventurerId === 'p1' ? 'strong' : 'weak' }]), ['incoming', { id: 'incoming', definitionId: 'medium' }]]);
    const actionView = { ...view(), phase: 'action1', partyLimit: 5, self: { party }, cards, enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss-card', kind: 'boss', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({
      ...context([play, end], [feature(play, { partyCombatGain: 2, partyCombatLoss: 5, overflowLoss: 1 })]), view: actionView,
      definitions: { strong: { id: 'strong', name: 'Strong', type: 'adventurer', copies: 1, source: 'test', combat: 5 }, weak: { id: 'weak', name: 'Weak', type: 'adventurer', copies: 1, source: 'test', combat: 1 }, medium: { id: 'medium', name: 'Medium', type: 'adventurer', copies: 1, source: 'test', combat: 2 } },
    });
    expect(result).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
    const lateGameView = { ...actionView, self: { ...actionView.self, history: { defeatedBosses: 0, defeatedMonsters: 10 } } } as PlayerView;
    const boundedRotation = decideCpuAction({
      ...context([play, end], [feature(play, { partyCombatGain: 3, partyCombatLoss: 5, overflowLoss: 1 })]), view: lateGameView,
      definitions: { strong: { id: 'strong', name: 'Strong', type: 'adventurer', copies: 1, source: 'test', combat: 5 }, weak: { id: 'weak', name: 'Weak', type: 'adventurer', copies: 1, source: 'test', combat: 1 }, medium: { id: 'medium', name: 'Medium', type: 'adventurer', copies: 1, source: 'test', combat: 2 } },
    });
    expect(boundedRotation).toMatchObject({ status: 'ready', command: play, reasonCode: 'PLAY_FOR_PARTY_POWER' });
    const beneficial = decideCpuAction({
      ...context([play, end], [feature(play, { partyCombatGain: 6, partyCombatLoss: 5, overflowLoss: 1 })]), view: actionView,
      definitions: { strong: { id: 'strong', name: 'Strong', type: 'adventurer', copies: 1, source: 'test', combat: 5 }, weak: { id: 'weak', name: 'Weak', type: 'adventurer', copies: 1, source: 'test', combat: 1 }, medium: { id: 'medium', name: 'Medium', type: 'adventurer', copies: 1, source: 'test', combat: 6 } },
    });
    expect(beneficial).toMatchObject({ status: 'ready', command: play, reasonCode: 'PLAY_FOR_PARTY_POWER' });
  });

  it('prioritizes permanent combat purchases while an available boss exceeds visible party power', () => {
    const honorBuy = { type: 'BUY_CARD' as const, cardId: 'honor-card' };
    const combatBuy = { type: 'BUY_CARD' as const, cardId: 'combat-card' };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const purchaseView = { ...view(), self: { turnCombatBonus: 0, party: [] }, cards: { boss: { id: 'boss', definitionId: 'boss-def' }, 'honor-card': { id: 'honor-card', definitionId: 'honor-def' }, 'combat-card': { id: 'combat-card', definitionId: 'combat-def' } }, enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss', kind: 'boss', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({
      ...context([honorBuy, combatBuy, end], [feature(honorBuy, { honorGain: 5, purchaseCost: 3 }), feature(combatBuy, { honorGain: 1, partyCombatGain: 3, purchaseCost: 3 })]), view: purchaseView,
      definitions: { 'boss-def': { id: 'boss-def', name: 'Boss', type: 'boss', copies: 1, source: 'test', combat: 14 }, 'honor-def': { id: 'honor-def', name: 'Honor', type: 'adventurer', copies: 1, source: 'test', honor: 5 }, 'combat-def': { id: 'combat-def', name: 'Combat', type: 'adventurer', copies: 1, source: 'test', combat: 3, honor: 1 } },
    });
    expect(result).toMatchObject({ status: 'ready', command: combatBuy, reasonCode: 'BUY_HIGHEST_UTILITY' });
  });

  it('rotates the item market for equipment after monster progression is exhausted', () => {
    const refreshAdventurer = { type: 'REFRESH_MARKET' as const, row: 'adventurer' as const, discardCardId: 'discard', refreshCardIds: ['adventurer'] };
    const refreshItem = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId: 'discard', refreshCardIds: ['item'] };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const purchaseView = {
      ...view(),
      self: { turnCombatBonus: 0, party: [{ adventurerId: 'party' }], history: { defeatedBosses: 0, defeatedMonsters: 10 } },
      cards: { boss: { id: 'boss', definitionId: 'boss-def' }, party: { id: 'party', definitionId: 'party-def' } },
      enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss', kind: 'boss', status: 'available' } },
    } as unknown as PlayerView;
    const result = decideCpuAction({
      ...context([refreshAdventurer, refreshItem, end], [feature(refreshAdventurer), feature(refreshItem)]),
      view: purchaseView,
      definitions: {
        'boss-def': { id: 'boss-def', name: 'Boss', type: 'boss', copies: 1, source: 'test', combat: 6 },
        'party-def': { id: 'party-def', name: 'Party', type: 'adventurer', copies: 1, source: 'test', combat: 4 },
      },
    });
    expect(result).toMatchObject({ status: 'ready', command: refreshItem, reasonCode: 'REFRESH_LOW_VALUE_MARKET' });
  });

  it('builds economy early, then stops spending an underpowered party on monsters', () => {
    const attackMonster = { type: 'ATTACK_TARGET' as const, targetId: 'monster' };
    const end = { type: 'END_PHASE' as const, phase: 'combat' as const };
    const combatView = {
      ...view(),
      phase: 'combat',
      self: { turnCombatBonus: 0, party: [{ adventurerId: 'party' }], history: { defeatedBosses: 0, defeatedMonsters: 5 } },
      cards: { boss: { id: 'boss', definitionId: 'boss-def' }, monster: { id: 'monster', definitionId: 'monster-def' }, party: { id: 'party', definitionId: 'party-def' } },
      enemyTargets: {
        boss: { targetId: 'boss', cardInstanceId: 'boss', kind: 'boss', status: 'available' },
        monster: { targetId: 'monster', cardInstanceId: 'monster', kind: 'monster', status: 'available' },
      },
    } as unknown as PlayerView;
    const result = decideCpuAction({
      ...context([attackMonster, end], [feature(attackMonster, { monsterDefeat: 1, honorGain: 3 })]),
      view: combatView,
      definitions: {
        'boss-def': { id: 'boss-def', name: 'Boss', type: 'boss', copies: 1, source: 'test', combat: 6 },
        'monster-def': { id: 'monster-def', name: 'Monster', type: 'monster', copies: 1, source: 'test', combat: 2 },
        'party-def': { id: 'party-def', name: 'Party', type: 'adventurer', copies: 1, source: 'test', combat: 2 },
      },
    });
    expect(result).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
    const earlyResult = decideCpuAction({
      ...context([attackMonster, end], [feature(attackMonster, { monsterDefeat: 1, honorGain: 3 })]),
      view: { ...combatView, self: { ...combatView.self, history: { defeatedBosses: 0, defeatedMonsters: 4 } } } as PlayerView,
      definitions: {
        'boss-def': { id: 'boss-def', name: 'Boss', type: 'boss', copies: 1, source: 'test', combat: 6 },
        'monster-def': { id: 'monster-def', name: 'Monster', type: 'monster', copies: 1, source: 'test', combat: 2 },
        'party-def': { id: 'party-def', name: 'Party', type: 'adventurer', copies: 1, source: 'test', combat: 2 },
      },
    });
    expect(earlyResult).toMatchObject({ status: 'ready', command: attackMonster, reasonCode: 'ATTACK_BEST_NET_VALUE' });
  });

  it('fails closed for an untyped mandatory effect choice', () => {
    const choice = { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: 'x', choiceId: 'unknown', optionId: 'first' };
    expect(decideCpuAction(context([choice]))).toMatchObject({ status: 'blocked', reasonCode: 'UNSUPPORTED_DECISION_KIND' });
  });

  it('resolves a typed discard prompt by choosing the lowest-utility visible card', () => {
    const low = { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: 'x', choiceId: 'discard-card', optionId: 'low' };
    const high = { ...low, optionId: 'high' };
    const typedView = { ...view(), decisionPrompt: { schemaVersion: 1 as const, decisionKind: 'discard-card' as const, choiceId: 'discard-card', minSelections: 1, maxSelections: 1, options: [{ id: 'low', cardId: 'low', definitionId: 'd-low' }, { id: 'high', cardId: 'high', definitionId: 'd-high' }] }, cards: { low: { id: 'low', definitionId: 'd-low' }, high: { id: 'high', definitionId: 'd-high' } } } as PlayerView;
    const result = decideCpuAction({ ...context([high, low]), view: typedView, definitions: { 'd-low': { id: 'd-low', name: 'Low', type: 'starter', copies: 1, source: 'test' }, 'd-high': { id: 'd-high', name: 'High', type: 'adventurer', copies: 1, combat: 5, honor: 3, source: 'test' } } });
    expect(result).toMatchObject({ status: 'ready', command: low, reasonCode: 'RESOLVE_HIGHEST_UTILITY_CHOICE' });
  });

  it('resolves a typed public-market reward by choosing the highest-utility visible card', () => {
    const low = { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: 'x', choiceId: 'market-card', optionId: 'low' };
    const high = { ...low, optionId: 'high' };
    const typedView = { ...view(), decisionPrompt: { schemaVersion: 1 as const, decisionKind: 'choose-market-card' as const, choiceId: 'market-card', minSelections: 1, maxSelections: 1, options: [{ id: 'low', cardId: 'low', definitionId: 'd-low' }, { id: 'high', cardId: 'high', definitionId: 'd-high' }] }, cards: { low: { id: 'low', definitionId: 'd-low' }, high: { id: 'high', definitionId: 'd-high' } } } as PlayerView;
    const result = decideCpuAction({ ...context([low, high]), view: typedView, definitions: { 'd-low': { id: 'd-low', name: 'Low', type: 'item', copies: 1, source: 'test', honor: 1 }, 'd-high': { id: 'd-high', name: 'High', type: 'equipment', copies: 1, source: 'test', combat: 2, honor: 2 } } });
    expect(result).toMatchObject({ status: 'ready', command: high, reasonCode: 'RESOLVE_HIGHEST_UTILITY_CHOICE' });
  });

  it('returns a structured repeat guard instead of silently stopping', () => {
    const runner = new CpuTurnRunner();
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const input = context([end], [feature(end)]);
    expect(runner.step(input).status).toBe('ready');
    expect(runner.step(input).status).toBe('ready');
    expect(runner.step(input).status).toBe('ready');
    expect(runner.step(input)).toMatchObject({ status: 'blocked', reasonCode: 'REPEATED_VISIBLE_STATE' });
  });
});
