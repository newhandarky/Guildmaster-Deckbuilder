import { describe, expect, it } from 'vitest';
import type { PartyCombatModifierRule } from '@guildmaster/game-protocol';
import { baseRulesModule, createGame, createRuleset, evaluateCombatPartyPrefix, evaluatePartyCombat, restoreSnapshot, serializeSnapshot, type RulesModule } from '../src/index.js';
import { testPack } from './fixtures.js';

const moduleWith = (...partyCombatModifierRules: PartyCombatModifierRule[]): RulesModule => ({
  id: 'test:party-combat', version: '1', partyCombatModifierRules,
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
});

const rule = (overrides: Partial<PartyCombatModifierRule> = {}): PartyCombatModifierRule => ({
  schemaVersion: 1, moduleId: 'test:party-combat', ruleId: 'adjacent-bonus', priority: 10,
  sourceDefinitionIds: ['test:adventurer/a'], subject: 'adjacent', when: { kind: 'always', value: true },
  amount: { kind: 'fixed', value: 2 }, ...overrides,
});

function game(rulesModule: RulesModule) {
  const ruleset = createRuleset([testPack], [baseRulesModule, rulesModule]);
  const state = createGame({ gameId: 'party-combat', seed: 71, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
  const sourceId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:adventurer/a')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((cardId) => cardId !== sourceId);
  const displaced = state.players[0]!.party[1]!.adventurerId;
  state.players[0]!.party[1] = { adventurerId: sourceId };
  state.players[0]!.discardPile.push(displaced);
  state.cards[sourceId]!.ownerId = 'p1';
  return { state, ruleset, sourceId };
}

describe('party combat modifier evaluator', () => {
  it('applies relation, position, target and per-member policies with per-card zero clamping', () => {
    const rulesModule = moduleWith(
      rule(),
      rule({ ruleId: 'source-penalty', priority: 20, subject: 'source', amount: { kind: 'per-other-party-member', value: -2 } }),
      rule({ ruleId: 'monster-first', priority: 30, subject: 'first', when: { kind: 'target-kind-in', kinds: ['monster'] }, amount: { kind: 'fixed', value: 1 } }),
    );
    const { state, ruleset, sourceId } = game(rulesModule);
    const monsterId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const evaluation = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: monsterId });
    expect(evaluation).toMatchObject({ status: 'ready', evaluation: { members: [
      { effectiveCombat: 4, modifierCombat: 3 },
      { adventurerId: sourceId, effectiveCombat: 0, modifierCombat: -8 },
      { effectiveCombat: 3, modifierCombat: 2 },
      { effectiveCombat: 1 },
      { effectiveCombat: 1 },
    ] } });
    const untargeted = evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1' });
    expect(untargeted.status === 'ready' ? untargeted.evaluation.members[0] : undefined).toMatchObject({ effectiveCombat: 3 });
    const replacementId = state.players[0]!.discardPile.find((cardId) => state.cards[cardId]?.definitionId === 'test:starter/adventurer')!;
    state.players[0]!.discardPile = state.players[0]!.discardPile.filter((cardId) => cardId !== replacementId);
    state.players[0]!.discardPile.push(sourceId);
    state.players[0]!.party[1] = { adventurerId: replacementId };
    expect(evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: monsterId })).toMatchObject({ status: 'ready', evaluation: { members: expect.arrayContaining([expect.objectContaining({ modifierCombat: 0, effectiveCombat: 1 })]) } });
  });

  it('is deterministic through Snapshot restore and drives the exact combat prefix without RNG mutation', () => {
    const { state, ruleset } = game(moduleWith(rule()));
    const targetId = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!.targetId;
    const before = structuredClone(state); const rng = state.rngState;
    expect(evaluateCombatPartyPrefix(state, ruleset, 'p1', 3, targetId)).toEqual({ slotCount: 1, power: 3, participantCardIds: [state.players[0]!.party[0]!.adventurerId] });
    expect(state).toEqual(before); expect(state.rngState).toBe(rng);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(evaluatePartyCombat(restored, ruleset, { schemaVersion: 1, playerId: 'p1', targetId })).toEqual(evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId }));
  });

  it('returns stable reason codes and rejects ambiguous or non-JSON policy registration', () => {
    const { state, ruleset } = game(moduleWith(rule()));
    expect(evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'missing' })).toMatchObject({ status: 'failed', reason: 'UNKNOWN_PLAYER' });
    expect(evaluatePartyCombat(state, ruleset, { schemaVersion: 1, playerId: 'p1', targetId: 'missing' })).toMatchObject({ status: 'failed', reason: 'UNKNOWN_TARGET' });
    const ambiguous = game(moduleWith(rule(), rule({ ruleId: 'same-priority' })));
    expect(evaluatePartyCombat(ambiguous.state, ambiguous.ruleset, { schemaVersion: 1, playerId: 'p1' })).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
    expect(() => createRuleset([testPack], [baseRulesModule, moduleWith(rule(), { ...rule(), priority: 20 })])).toThrow('Duplicate party combat modifier rule');
    expect(() => createRuleset([testPack], [baseRulesModule, moduleWith(rule({ sourceDefinitionIds: ['test:missing'] }))])).toThrow('unknown source definition');
    expect(() => createRuleset([testPack], [baseRulesModule, moduleWith(rule({ sourceDefinitionIds: ['test:item/spear'] }))])).toThrow('must be an adventurer or starter');
    expect(() => createRuleset([testPack], [baseRulesModule, moduleWith(rule({ sourceDefinitionIds: ['test:adventurer/a', 'test:adventurer/a'] }))])).toThrow('must be unique');
    const cyclic = rule() as PartyCombatModifierRule & { cycle?: unknown }; cyclic.cycle = cyclic;
    expect(() => createRuleset([testPack], [baseRulesModule, moduleWith(cyclic)])).toThrow('JSON-only');
  });
});
