import { describe, expect, it } from 'vitest';
import type { CpuActionFeature, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import { CpuTurnRunner, baseBalancedCpuProfile, beginnerCpuProfile, cpuDifficultyForProfile, cpuProfileForDifficulty, decideCpuAction, standardCpuProfile } from '../src/index.js';

const view = (revision = 1) => ({ viewerId: 'cpu-1', gameId: 'g', status: 'playing', phase: 'purchase', round: 1, revision, activePlayerId: 'cpu-1' } as unknown as PlayerView);
const feature = (command: GameCommand, values: Partial<CpuActionFeature> = {}): CpuActionFeature => ({ schemaVersion: 2, command, honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, equipmentRemoval: 0, overflowLoss: 0, targetCombatProgress: [], ...values });
const context = (legalCommands: GameCommand[], actionFeatures: CpuActionFeature[] = []) => ({ view: view(), legalCommands, actionFeatures, definitions: {}, rulesetFingerprint: 'rules', profile: baseBalancedCpuProfile });

describe('deterministic CPU strategy', () => {
  it('equips the participant that unlocks a public boss attack and reports the boss-progress reason', () => {
    const equipFirst = { type: 'EQUIP_ITEM' as const, cardId: 'spear', adventurerId: 'first' };
    const equipOther = { type: 'EQUIP_ITEM' as const, cardId: 'spear', adventurerId: 'other' };
    const end = { type: 'END_PHASE' as const, phase: 'action1' as const };
    const progress = (effectiveCombatAfter: number) => [{ targetId: 'boss', targetKind: 'boss', requiredCombat: 6, effectiveCombatBefore: 4, effectiveCombatAfter, shortfallBefore: 2, shortfallAfter: Math.max(0, 6 - effectiveCombatAfter), attackReadyBefore: false, attackReadyAfter: effectiveCombatAfter >= 6 }];
    const actionView = { ...view(), phase: 'action1', self: { party: [{ adventurerId: 'first' }, { adventurerId: 'other' }], history: { defeatedBosses: 0, defeatedMonsters: 5 } }, enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss-card', kind: 'boss', status: 'available', maximumPartySlots: 1 } } } as unknown as PlayerView;
    const input = { ...context([equipOther, equipFirst, end], [feature(equipOther, { partyCombatGain: 3, targetCombatProgress: progress(4) }), feature(equipFirst, { partyCombatGain: 3, targetCombatProgress: progress(7) })]), view: actionView };
    const first = decideCpuAction(input);
    const second = decideCpuAction(structuredClone(input));
    expect(first).toMatchObject({ status: 'ready', command: equipFirst, reasonCode: 'ADVANCE_BOSS_COMBAT' });
    expect(second).toEqual(first);
    if (first.status === 'ready') expect(first.contextFingerprint).toMatch(/^v1:[0-9a-f]{32}$/);
  });

  it('uses utility score before canonical order when commands make equal boss progress', () => {
    const destructive = { type: 'EQUIP_ITEM' as const, cardId: 'a-destructive', adventurerId: 'first' };
    const safe = { type: 'EQUIP_ITEM' as const, cardId: 'z-safe', adventurerId: 'first' };
    const end = { type: 'END_PHASE' as const, phase: 'action1' as const };
    const progress = [{ targetId: 'boss', targetKind: 'boss', requiredCombat: 6, effectiveCombatBefore: 4, effectiveCombatAfter: 6, shortfallBefore: 2, shortfallAfter: 0, attackReadyBefore: false, attackReadyAfter: true }];
    const actionView = { ...view(), phase: 'action1', self: { party: [{ adventurerId: 'first' }], history: { defeatedBosses: 0, defeatedMonsters: 5 } }, enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss-card', kind: 'boss', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({ ...context([destructive, safe, end], [feature(destructive, { partyCombatGain: 2, partyCombatLoss: 4, equipmentLoss: 1, targetCombatProgress: progress }), feature(safe, { partyCombatGain: 2, targetCombatProgress: progress })]), view: actionView });
    expect(result).toMatchObject({ status: 'ready', command: safe, reasonCode: 'ADVANCE_BOSS_COMBAT' });
  });

  it('blocks obsolete action-feature inputs with a structured diagnostic', () => {
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const legacyRecord = structuredClone(feature(end)) as unknown as Record<string, unknown>;
    delete legacyRecord.targetCombatProgress; legacyRecord.schemaVersion = 1;
    const legacy = legacyRecord as unknown as CpuActionFeature;
    expect(decideCpuAction(context([end], [legacy]))).toMatchObject({ status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE', diagnostic: expect.stringContaining('schemaVersion 2') });
    expect(new CpuTurnRunner().step(context([end], [legacy]))).toMatchObject({ status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE' });
  });

  it('returns exactly the same command, score and fingerprint for identical input', () => {
    const buy = { type: 'BUY_CARD' as const, cardId: 'card-1' };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const input = context([buy, end], [feature(buy, { honorGain: 2, purchaseCost: 3 })]);
    const decisions = Array.from({ length: 100 }, () => decideCpuAction(input));
    expect(new Set(decisions.map((decision) => JSON.stringify(decision))).size).toBe(1);
    expect(decisions[0]).toMatchObject({ status: 'ready', command: buy, reasonCode: 'BUY_HIGHEST_UTILITY' });
  });

  it('activates an independent card effect when it makes combat progress and reports its reason code', () => {
    const activation = { type: 'ACTIVATE_CARD_EFFECT' as const, cardId: 'mage', targetId: 'monster' };
    const end = { type: 'END_PHASE' as const, phase: 'combat' as const };
    const combatView = { ...view(), phase: 'combat', enemyTargets: { monster: { targetId: 'monster', cardInstanceId: 'monster-card', kind: 'monster', status: 'available' } } } as unknown as PlayerView;
    const input = { ...context([activation, end], [feature(activation, { immediateCombatPower: 3 })]), view: combatView };
    const result = decideCpuAction(input);
    expect(result).toMatchObject({ status: 'ready', command: activation, reasonCode: 'ACTIVATE_CARD_EFFECT_FOR_COMBAT_PROGRESS' });
    expect(decideCpuAction(structuredClone(input))).toEqual(result);
  });

  it('does not spend an independent card effect when the target can already be defeated normally', () => {
    const normal = { type: 'ATTACK_TARGET' as const, targetId: 'monster' };
    const activation = { type: 'ACTIVATE_CARD_EFFECT' as const, cardId: 'mage', targetId: 'monster' };
    const combatView = { ...view(), phase: 'combat', enemyTargets: { monster: { targetId: 'monster', cardInstanceId: 'monster-card', kind: 'monster', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({ ...context([activation, normal], [feature(activation, { immediateCombatPower: 2 }), feature(normal, { monsterDefeat: 1 })]), view: combatView });
    expect(result).toMatchObject({ status: 'ready', command: normal, reasonCode: 'ATTACK_BEST_NET_VALUE' });
  });

  it('preserves generic combat-assist decisions and never spends one when the same normal attack is legal', () => {
    const normal = { type: 'ATTACK_TARGET' as const, targetId: 'monster' };
    const assist = { ...normal, combatAssistCardId: 'support' };
    const combatView = { ...view(), phase: 'combat', enemyTargets: { monster: { targetId: 'monster', cardInstanceId: 'monster-card', kind: 'monster', status: 'available' } } } as unknown as PlayerView;
    const assistedOnly = decideCpuAction({ ...context([assist], [feature(assist, { monsterDefeat: 1 })]), view: combatView });
    expect(assistedOnly).toMatchObject({ status: 'ready', command: assist, reasonCode: 'ATTACK_WITH_COMBAT_ASSIST' });
    const normalAvailable = decideCpuAction({ ...context([assist, normal], [feature(assist, { monsterDefeat: 1 }), feature(normal, { monsterDefeat: 1 })]), view: combatView });
    expect(normalAvailable).toMatchObject({ status: 'ready', command: normal, reasonCode: 'ATTACK_BEST_NET_VALUE' });
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
    expect(boundedRotation).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
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

  it('does not force combat purchases or refreshes when public features show the boss is already attack-ready', () => {
    const honorBuy = { type: 'BUY_CARD' as const, cardId: 'honor-card' };
    const combatBuy = { type: 'BUY_CARD' as const, cardId: 'combat-card' };
    const refresh = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId: 'discard', refreshCardIds: ['item'] };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    const ready = [{ targetId: 'boss', targetKind: 'boss', requiredCombat: 6, effectiveCombatBefore: 6, effectiveCombatAfter: 6, shortfallBefore: 0, shortfallAfter: 0, attackReadyBefore: true, attackReadyAfter: true }];
    const purchaseView = { ...view(), self: { turnCombatBonus: 0, party: [{ adventurerId: 'first' }], history: { defeatedBosses: 0, defeatedMonsters: 5 } }, enemyTargets: { boss: { targetId: 'boss', cardInstanceId: 'boss-card', kind: 'boss', status: 'available' } } } as unknown as PlayerView;
    const result = decideCpuAction({ ...context([combatBuy, honorBuy, refresh, end], [feature(combatBuy, { partyCombatGain: 3, purchaseCost: 3, targetCombatProgress: ready }), feature(honorBuy, { honorGain: 5, purchaseCost: 3, targetCombatProgress: ready }), feature(refresh, { targetCombatProgress: ready })]), view: purchaseView });
    expect(result).toMatchObject({ status: 'ready', command: honorBuy, reasonCode: 'BUY_HIGHEST_UTILITY' });
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

  it('deterministically accepts every available combat departure replacement', () => {
    const decline = { type: 'RESOLVE_EFFECT_CHOICE' as const, executionId: 'combat-departure:x', choiceId: 'combat-departure:optional-replacements', optionId: 'departure-0' };
    const accept = { ...decline, optionId: 'departure-1' };
    const typedView = { ...view(), decisionPrompt: { schemaVersion: 1 as const, decisionKind: 'choose-party-member' as const, choiceId: decline.choiceId, minSelections: 1, maxSelections: 1, options: [{ id: decline.optionId }, { id: accept.optionId }] } } as PlayerView;
    const input = { ...context([decline, accept]), view: typedView };
    expect(decideCpuAction(input)).toMatchObject({ status: 'ready', command: accept, reasonCode: 'RESOLVE_HIGHEST_UTILITY_CHOICE' });
    expect(decideCpuAction(structuredClone(input))).toEqual(decideCpuAction(input));
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

  it('maps all public difficulties to stable profiles while keeping legacy balanced as challenge', () => {
    expect(cpuProfileForDifficulty('beginner')).toBe(beginnerCpuProfile);
    expect(cpuProfileForDifficulty('standard')).toBe(standardCpuProfile);
    expect(cpuProfileForDifficulty('challenge')).toBe(baseBalancedCpuProfile);
    expect(cpuDifficultyForProfile(baseBalancedCpuProfile.profileId, baseBalancedCpuProfile.version)).toBe('challenge');
    expect(cpuDifficultyForProfile('unknown', '1')).toBeUndefined();
  });

  it('uses a deterministic eligible second-best action every third beginner decision without weakening mandatory choices', () => {
    const best = { type: 'PLAY_ADVENTURER' as const, cardId: 'best' };
    const second = { type: 'PLAY_ADVENTURER' as const, cardId: 'second' };
    const end = { type: 'END_PHASE' as const, phase: 'action1' as const };
    const input = { ...context([best, second, end], [feature(best, { partyCombatGain: 10 }), feature(second, { partyCombatGain: 7 })]), profile: beginnerCpuProfile, view: { ...view(), phase: 'action1' } as PlayerView };
    expect(decideCpuAction({ ...input, decisionOrdinal: 1 })).toMatchObject({ status: 'ready', command: best });
    expect(decideCpuAction({ ...input, decisionOrdinal: 3 })).toMatchObject({ status: 'ready', command: second });
    expect(decideCpuAction({ ...input, profile: standardCpuProfile, decisionOrdinal: 3 })).toMatchObject({ status: 'ready', command: best });
  });
});
