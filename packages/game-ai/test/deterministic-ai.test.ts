import { describe, expect, it } from 'vitest';
import type { CpuActionFeature, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import { CpuTurnRunner, baseBalancedCpuProfile, decideCpuAction } from '../src/index.js';

const view = (revision = 1) => ({ viewerId: 'cpu-1', gameId: 'g', status: 'playing', phase: 'purchase', round: 1, revision, activePlayerId: 'cpu-1' } as unknown as PlayerView);
const feature = (command: GameCommand, values: Partial<CpuActionFeature> = {}): CpuActionFeature => ({ schemaVersion: 1, command, honorGain: 0, bondHonorGain: 0, bossProgress: 0, monsterDefeat: 0, permanentPurchasePower: 0, partyCombatGain: 0, cardsDrawn: 0, removalValue: 0, immediatePurchasePower: 0, immediateCombatPower: 0, purchaseCost: 0, partyCombatLoss: 0, equipmentLoss: 0, overflowLoss: 0, ...values });
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

  it('ends a phase when every optional action has no positive utility', () => {
    const refresh = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId: 'hand', refreshCardIds: ['row'] };
    const end = { type: 'END_PHASE' as const, phase: 'purchase' as const };
    expect(decideCpuAction(context([refresh, end], [feature(refresh)]))).toMatchObject({ status: 'ready', command: end, reasonCode: 'END_NO_POSITIVE_ACTION' });
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
