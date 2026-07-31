import { describe, expect, it } from 'vitest';
import type { CombatRewardPolicy, CommandEnvelope, ContentPack, DomainEvent, EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import {
  createGame,
  createRuleset,
  dispatch,
  envelope,
  getLegalCommands,
  projectPlayerView,
  replayGame,
  replayRegistryFingerprint,
  restoreSnapshot,
  serializeSnapshot,
  validateSupplyContinuityState
} from '../src/index.js';
import { refillSupply } from '../src/engine/supply.js';
import { attachTargets } from '../src/engine/create-game.js';
import { baseZoneIds } from '../src/model/zones.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

const cyclePack: ContentPack = {
  manifest: { id: 'test:cycle-content', version: '1', hash: 'cycle-v1', role: 'base' },
  definitions: [
    { id: 'test:cycle/starter', name: 'Cycle starter', type: 'starter', copies: 0, combat: 10, source: 'test' },
    { id: 'test:cycle/stone', name: 'Cycle stone', type: 'starter', copies: 0, source: 'test' },
    { id: 'test:cycle/crystal', name: 'Cycle crystal', type: 'starter', copies: 0, source: 'test' },
    { id: 'test:cycle/anchor', name: 'Cycle anchor', type: 'monster', copies: 3, combat: 1, source: 'test', tags: ['base:supply-cycle-anchor'] }
  ],
  starter: { adventurerDefinitionId: 'test:cycle/starter', summonStoneDefinitionId: 'test:cycle/stone', crystalDefinitionId: 'test:cycle/crystal' },
  bonds: [{ id: 'test:cycle/bond', name: 'Never automatic', honor: 0, requiredBosses: 99 }]
};

const cycleRuleset = () => createRuleset([cyclePack], [baseRulesModule]);
const cycleConfig = {
  gameId: 'cycle-game',
  seed: 73,
  players: [{ id: 'p1', name: 'P1', kind: 'human' as const }, { id: 'p2', name: 'P2', kind: 'ai' as const }],
  startingPlayerId: 'p1'
};
const availableTargetFor = (state: ReturnType<typeof createGame>, cardId: string) => Object.values(state.enemyTargets).find((target) => target.cardInstanceId === cardId && target.status === 'available')!;

function moveCardsToRemoved(state: ReturnType<typeof makeGame>, cardIds: readonly string[]): void {
  state.removedCards.push(...cardIds);
}

function emptySupply(state: ReturnType<typeof makeGame>, rowId: string, deckId: string): void {
  const cards = [...state.zones[rowId]!.cardIds, ...state.zones[deckId]!.cardIds];
  state.zones[rowId]!.cardIds = [];
  state.zones[deckId]!.cardIds = [];
  moveCardsToRemoved(state, cards);
}

describe('approved base supply continuity policy', () => {
  it('registers finite JSON policies and rejects incompatible cycle registries', () => {
    expect(baseRulesModule.supplyContinuityPolicies).toHaveLength(3);
    expect(() => createRuleset([{ ...cyclePack, definitions: cyclePack.definitions.map((definition) => definition.id === 'test:cycle/anchor' ? { ...definition, copies: 2 } : definition) }], [baseRulesModule])).toThrow('requires exactly one 3-copy monster definition');
    const malformed = { ...baseRulesModule, supplyContinuityPolicies: [{ ...baseRulesModule.supplyContinuityPolicies![0]!, schemaVersion: 2 }] } as unknown as RulesModule;
    expect(() => createRuleset([cyclePack], [malformed])).toThrow('unsupported schema version');
    const invalidDestination = { ...baseRulesModule, supplyContinuityPolicies: baseRulesModule.supplyContinuityPolicies!.map((policy) => policy.supply === 'monster' ? { ...policy, cycleDestination: 'player-discard' } : policy) } as unknown as RulesModule;
    expect(() => createRuleset([cyclePack], [invalidDestination])).toThrow('requires source-deck-bottom recycling');
  });

  it('allows adventurer and item rows to become empty without freezing commands', () => {
    let state = makeGame();
    emptySupply(state, baseZoneIds.adventurerRow, baseZoneIds.adventurerDeck);
    emptySupply(state, baseZoneIds.itemRow, baseZoneIds.itemDeck);
    expect(getLegalCommands(state, testRuleset, 'p1')).toContainEqual({ type: 'END_PHASE', phase: 'action1' });
    for (const phase of ['action1', 'combat', 'action2', 'purchase', 'rest'] as const) {
      const result = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'END_PHASE', phase }, `continue-after-empty-${phase}`));
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    expect(state).toMatchObject({ status: 'playing', phase: 'action1', activePlayerId: 'p2', revision: 5 });
    expect(state.zones[baseZoneIds.adventurerRow]!.cardIds).toEqual([]);
    expect(state.zones[baseZoneIds.itemRow]!.cardIds).toEqual([]);
    expect(getLegalCommands(state, testRuleset, 'p2')).toContainEqual({ type: 'END_PHASE', phase: 'action1' });
  });

  it('lets a synthetic Vol.1 hook observe adventurer/item depletion once and never monster continuity', () => {
    const vol1SupplyHook: RulesModule = {
      id: 'test:vol1-supply-hook',
      version: '1',
      createInitialState: () => ({ depleted: [] }),
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: (state, supply) => {
        const moduleState = state.moduleState['test:vol1-supply-hook'] as { depleted: string[] };
        moduleState.depleted.push(supply);
        return 'handled';
      }
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, vol1SupplyHook]);
    const state = createGame({ ...cycleConfig, gameId: 'supply-audit' }, ruleset);
    const events: DomainEvent[] = [];
    for (const [supply, rowId, deckId] of [
      ['adventurer', baseZoneIds.adventurerRow, baseZoneIds.adventurerDeck],
      ['item', baseZoneIds.itemRow, baseZoneIds.itemDeck]
    ] as const) {
      const removedRow = state.zones[rowId]!.cardIds.splice(2);
      const lastCard = state.zones[deckId]!.cardIds.pop()!;
      moveCardsToRemoved(state, [...removedRow, ...state.zones[deckId]!.cardIds.splice(0)]);
      state.zones[deckId]!.cardIds = [lastCard];
      refillSupply(state, ruleset, supply, events);
      refillSupply(state, ruleset, supply, events);
    }
    const monsterCard = state.zones[baseZoneIds.monsterRow]!.cardIds.pop()!;
    state.zones[baseZoneIds.monsterDeck]!.cardIds.push(monsterCard);
    refillSupply(state, ruleset, 'monster', events);
    expect(events.filter(({ type }) => type === 'SUPPLY_DECK_DEPLETED')).toHaveLength(2);
    expect((state.moduleState['test:vol1-supply-hook'] as { depleted: string[] }).depleted).toEqual(['adventurer', 'item']);
    expect(state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(state.status).toBe('playing');
  });

  it('commits simultaneous adventurer and item depletion once during the same rest', () => {
    const state = makeGame();
    state.phase = 'rest';
    for (const [rowId, deckId] of [
      [baseZoneIds.adventurerRow, baseZoneIds.adventurerDeck],
      [baseZoneIds.itemRow, baseZoneIds.itemDeck]
    ] as const) {
      moveCardsToRemoved(state, state.zones[rowId]!.cardIds.splice(2));
      const finalCard = state.zones[deckId]!.cardIds.pop()!;
      moveCardsToRemoved(state, state.zones[deckId]!.cardIds.splice(0));
      state.zones[deckId]!.cardIds = [finalCard];
    }
    const result = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'rest' }, 'simultaneous-depletion'));
    expect(result.error).toBeUndefined();
    expect(result.state).toMatchObject({ status: 'playing', revision: 1 });
    expect(result.events.filter(({ type }) => type === 'SUPPLY_DECK_DEPLETED')).toHaveLength(2);
    expect(result.state.eventLogCursor).toBe(result.events.length);
    expect(result.state.zones[baseZoneIds.adventurerRow]!.cardIds).toHaveLength(3);
    expect(result.state.zones[baseZoneIds.itemRow]!.cardIds).toHaveLength(3);
  });

  it('cycles the same three anchors with new target IDs and one transaction commit per defeat', () => {
    const ruleset = cycleRuleset();
    let state = createGame(cycleConfig, ruleset);
    state.phase = 'combat';
    state.players[0]!.turnCombatBonus = 99;
    const rng = state.rngState;
    const seenTargetIds = new Set<string>();
    const seenEventIds = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      expect(state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
      const cardId = state.zones[baseZoneIds.monsterRow]!.cardIds[index % 3]!;
      const target = availableTargetFor(state, cardId);
      seenTargetIds.add(target.targetId);
      const previousRevision = state.revision;
      const previousCursor = state.eventLogCursor;
      const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: target.targetId }, `cycle-${index + 1}`));
      expect(result.error).toBeUndefined();
      expect(result.state.revision).toBe(previousRevision + 1);
      expect(result.state.eventLogCursor).toBe(previousCursor + result.events.length);
      expect(result.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
      expect(result.state.players[0]!.discardPile).not.toContain(cardId);
      expect(result.events.some(({ type }) => type === 'SUPPLY_DECK_DEPLETED')).toBe(false);
      expect(result.events.every(({ causedByCommandId }) => causedByCommandId === `cycle-${index + 1}`)).toBe(true);
      for (const event of result.events) {
        expect(seenEventIds.has(event.eventId)).toBe(false);
        seenEventIds.add(event.eventId);
      }
      state = result.state;
    }
    expect(seenTargetIds.size).toBe(5);
    expect(state.rngState).toBe(rng);
    expect(validateSupplyContinuityState(state, ruleset)).toEqual([]);
    expect(projectPlayerView(state, ruleset, 'p1').zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
  });

  it('places the three anchors beneath ordinary monsters and reaches them as the final full row', () => {
    const state = makeGame();
    const deck = state.zones[baseZoneIds.monsterDeck]!.cardIds;
    expect(deck.slice(0, 3).every((cardId) => state.cards[cardId]!.definitionId === 'test:monster/anchor')).toBe(true);
    const ordinaryCards = [...state.zones[baseZoneIds.monsterRow]!.cardIds, ...deck.filter((cardId) => state.cards[cardId]!.definitionId === 'test:monster/wolf')];
    for (const cardId of state.zones[baseZoneIds.monsterRow]!.cardIds) availableTargetFor(state, cardId).status = 'removed';
    state.zones[baseZoneIds.monsterRow]!.cardIds = [];
    state.zones[baseZoneIds.monsterDeck]!.cardIds = deck.filter((cardId) => state.cards[cardId]!.definitionId === 'test:monster/anchor');
    moveCardsToRemoved(state, ordinaryCards);
    refillSupply(state, testRuleset, 'monster', []);
    attachTargets(state);
    expect(state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(state.zones[baseZoneIds.monsterRow]!.cardIds.every((cardId) => state.cards[cardId]!.definitionId === 'test:monster/anchor')).toBe(true);
    expect(validateSupplyContinuityState(state, testRuleset)).toEqual([]);
  });

  it('round-trips and replays repeated cycle defeats deterministically', () => {
    const ruleset = cycleRuleset();
    let state = createGame(cycleConfig, ruleset);
    const commands: CommandEnvelope[] = [];
    const toCombat = envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'cycle-to-combat');
    commands.push(toCombat);
    state = dispatch(state, ruleset, toCombat).state;
    for (let index = 0; index < 2; index += 1) {
      const target = Object.values(state.enemyTargets).find(({ status }) => status === 'available')!;
      const command = envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: target.targetId }, `replay-cycle-${index + 1}`);
      commands.push(command);
      const result = dispatch(state, ruleset, command);
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    const roundTripped = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), ruleset);
    expect(roundTripped).toEqual(state);
    const replay = replayGame({ schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(ruleset), initialConfig: cycleConfig, commands, expectedFinalSnapshot: serializeSnapshot(state) }, ruleset);
    expect(replay.status).toBe('completed');
    if (replay.status !== 'completed') return;
    expect(replay.finalSnapshot.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(new Set(replay.events.map(({ eventId }) => eventId)).size).toBe(replay.events.length);
  });

  it('keeps the full monster row through reward consent suspension without replaying combat or rewards', () => {
    const rewardBody: EffectDefinition['body'] = {
      kind: 'request-counter-consent',
      requestId: 'cycle-reward-consent',
      policy: { moduleId: 'test:cycle-reward', policyId: 'cycle-reward-policy' },
      counterOwner: { kind: 'controller' },
      outcomes: {
        accepted: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 2 },
        declined: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
        cancelled: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
        expired: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 }
      }
    };
    const rewardPolicy: CombatRewardPolicy = { schemaVersion: 1, rewardPolicyId: 'cycle-reward', moduleId: 'test:cycle-reward', priority: 1, condition: { kind: 'always', value: true }, recipient: 'defeating-player', reward: { schemaVersion: 1, effectId: 'cycle-reward', body: rewardBody } };
    const rewardModule: RulesModule = {
      id: 'test:cycle-reward',
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      combatRewardPolicies: [rewardPolicy],
      counterConsentPolicies: [{ schemaVersion: 1, moduleId: 'test:cycle-reward', policyId: 'cycle-reward-policy', resourceId: 'test:cycle/token', requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' } }]
    };
    const ruleset = createRuleset([cyclePack], [baseRulesModule, rewardModule]);
    const state = createGame({ ...cycleConfig, gameId: 'cycle-consent', players: [...cycleConfig.players, { id: 'p3', name: 'P3', kind: 'human' as const }] }, ruleset);
    state.phase = 'combat';
    state.players[0]!.turnCombatBonus = 99;
    state.players[0]!.counters.push({ resourceId: 'test:cycle/token', amount: 1, visibility: 'allPlayersByConsent' });
    const cardId = state.zones[baseZoneIds.monsterRow]!.cardIds[0]!;
    const targetId = availableTargetFor(state, cardId).targetId;
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'cycle-consent'));
    expect(suspended.state.revision).toBe(0);
    expect(suspended.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(suspended.state.enemyTargets[targetId]!.status).toBe('available');
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const partial = dispatch(restored, ruleset, envelope(restored, 'p2', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'cycle-reward-consent', response: 'accept' }, 'cycle-consent-p2'));
    expect(partial.state.revision).toBe(0);
    expect(partial.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    const completed = dispatch(partial.state, ruleset, envelope(partial.state, 'p3', { type: 'RESPOND_COUNTER_CONSENT', requestId: 'cycle-reward-consent', response: 'accept' }, 'cycle-consent-p3'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(completed.state.players[0]!.discardPile).not.toContain(cardId);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_EVALUATED')).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_REWARD_POLICY_EXECUTED')).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'ENEMY_DEFEATED')).toHaveLength(1);
  });

  it('keeps a completed refill stable through post-command choice and rolls late failure back to command start', () => {
    const choice = (effectId: string): LifecycleHook => ({
      schemaVersion: 1,
      moduleId: 'test:cycle-post',
      hookId: effectId,
      point: 'command-after',
      kind: 'trigger',
      priority: 1,
      effect: { schemaVersion: 1, effectId, body: { kind: 'choice', choiceId: effectId, actor: { kind: 'controller' }, options: [{ id: 'continue', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 } }] } }
    });
    const postModule: RulesModule = { id: 'test:cycle-post', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [choice('post-cycle-choice')] };
    const ruleset = createRuleset([cyclePack], [baseRulesModule, postModule]);
    const state = createGame({ ...cycleConfig, gameId: 'cycle-post' }, ruleset);
    state.phase = 'combat';
    state.players[0]!.turnCombatBonus = 99;
    const cardId = state.zones[baseZoneIds.monsterRow]!.cardIds[0]!;
    const targetId = availableTargetFor(state, cardId).targetId;
    const suspended = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'post-cycle'));
    expect(suspended.state.revision).toBe(0);
    expect(suspended.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    const targetCount = Object.values(suspended.state.enemyTargets).filter(({ cardInstanceId }) => cardInstanceId === cardId).length;
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(suspended.state))), ruleset);
    const resolution = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', resolution, 'post-cycle-resume'));
    expect(completed.error).toBeUndefined();
    expect(completed.state.revision).toBe(1);
    expect(completed.state.zones[baseZoneIds.monsterRow]!.cardIds).toHaveLength(3);
    expect(Object.values(completed.state.enemyTargets).filter(({ cardInstanceId }) => cardInstanceId === cardId)).toHaveLength(targetCount);
    expect(completed.events.filter(({ type }) => type === 'COMBAT_EVALUATED')).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === 'ENEMY_DEFEATED')).toHaveLength(1);

    const failureHook: LifecycleHook = {
      ...choice('late-cycle-failure'),
      effect: {
        schemaVersion: 1,
        effectId: 'late-cycle-failure',
        body: {
          kind: 'sequence',
          effects: [
            choice('late-cycle-failure').effect.body,
            { kind: 'move-card', card: { kind: 'card-instance', cardInstanceId: 'missing' }, from: { kind: 'removed' }, to: { kind: 'player-zone', player: { kind: 'controller' }, zone: 'hand' } }
          ]
        }
      }
    };
    const failureRuleset = createRuleset([cyclePack], [baseRulesModule, { ...postModule, lifecycleHooks: [failureHook] }]);
    const failureState = createGame({ ...cycleConfig, gameId: 'cycle-post-failure' }, failureRuleset);
    failureState.phase = 'combat';
    failureState.players[0]!.turnCombatBonus = 99;
    const before = structuredClone(failureState);
    const failureTarget = Object.values(failureState.enemyTargets).find(({ status }) => status === 'available')!.targetId;
    const pending = dispatch(failureState, failureRuleset, envelope(failureState, 'p1', { type: 'ATTACK_TARGET', targetId: failureTarget }, 'late-cycle'));
    const failureChoice = getLegalCommands(pending.state, failureRuleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const failed = dispatch(pending.state, failureRuleset, envelope(pending.state, 'p1', failureChoice, 'late-cycle-resume'));
    expect(failed.error).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(failed.state).toEqual(before);
    expect(failed.events).toEqual([]);
  });

  it('rejects remove-target replacement for a cycle anchor in both query and dispatch', () => {
    const replacement: RulesModule = {
      id: 'test:cycle-removal',
      version: '1',
      getPartyLimit: (_state, _player, limit) => limit,
      onSupplyDepleted: () => 'handled',
      combatRules: [{ schemaVersion: 1, moduleId: 'test:cycle-removal', ruleId: 'remove-anchor', priority: 1, kind: 'replacement', when: { kind: 'always', value: true }, outcome: { kind: 'remove-target' } }]
    };
    const ruleset = createRuleset([cyclePack], [baseRulesModule, replacement]);
    const state = createGame({ ...cycleConfig, gameId: 'cycle-removal' }, ruleset);
    state.phase = 'combat';
    state.players[0]!.turnCombatBonus = 99;
    const targetId = Object.values(state.enemyTargets).find(({ status }) => status === 'available')!.targetId;
    expect(getLegalCommands(state, ruleset, 'p1').some((command) => command.type === 'ATTACK_TARGET')).toBe(false);
    const before = structuredClone(state);
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId }, 'remove-cycle-anchor'));
    expect(result.error?.message).toContain('CYCLE_ANCHOR_REMOVAL_FORBIDDEN');
    expect(result.state).toEqual(before);
  });

  it('rejects malformed committed monster supply snapshots and old module registries', () => {
    const ruleset = cycleRuleset();
    const state = createGame(cycleConfig, ruleset);
    const shortRow = JSON.parse(JSON.stringify(serializeSnapshot(state)));
    const removedCardId = shortRow.state.zones[baseZoneIds.monsterRow].cardIds.pop();
    const removedTarget = Object.values(shortRow.state.enemyTargets as Record<string, { cardInstanceId: string; status: string }>).find(({ cardInstanceId }) => cardInstanceId === removedCardId)!;
    removedTarget.status = 'removed';
    shortRow.state.removedCards.push(removedCardId);
    expect(() => restoreSnapshot(shortRow, ruleset)).toThrow('monster row must contain exactly 3 cards');
    const missingTarget = JSON.parse(JSON.stringify(serializeSnapshot(state)));
    const rowCard = missingTarget.state.zones[baseZoneIds.monsterRow].cardIds[0];
    const targetId = Object.values(missingTarget.state.enemyTargets as Record<string, { cardInstanceId: string }>).find(({ cardInstanceId }) => cardInstanceId === rowCard) ? Object.entries(missingTarget.state.enemyTargets as Record<string, { cardInstanceId: string }>).find(([, target]) => target.cardInstanceId === rowCard)![0] : '';
    delete missingTarget.state.enemyTargets[targetId];
    expect(() => restoreSnapshot(missingTarget, ruleset)).toThrow();
    const duplicateRow = JSON.parse(JSON.stringify(serializeSnapshot(state)));
    duplicateRow.state.zones[baseZoneIds.monsterRow].cardIds[1] = duplicateRow.state.zones[baseZoneIds.monsterRow].cardIds[0];
    expect(() => restoreSnapshot(duplicateRow, ruleset)).toThrow();
    const playerOwned = makeGame();
    const anchorId = playerOwned.zones[baseZoneIds.monsterDeck]!.cardIds.find((cardId) => playerOwned.cards[cardId]!.definitionId === 'test:monster/anchor')!;
    playerOwned.zones[baseZoneIds.monsterDeck]!.cardIds.splice(playerOwned.zones[baseZoneIds.monsterDeck]!.cardIds.indexOf(anchorId), 1);
    playerOwned.players[0]!.hand.push(anchorId);
    expect(() => restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(playerOwned))), testRuleset)).toThrow('cannot enter a player-owned zone');
    const oldRuleset = createRuleset([cyclePack], [{ ...baseRulesModule, version: '0.2.0' }]);
    expect(() => restoreSnapshot(serializeSnapshot(state), oldRuleset)).toThrow('registry fingerprint');
    const oldPackRuleset = createRuleset([{ ...cyclePack, manifest: { ...cyclePack.manifest, version: '0', hash: 'cycle-v0' } }], [baseRulesModule]);
    expect(() => restoreSnapshot(serializeSnapshot(state), oldPackRuleset)).toThrow('registry fingerprint');
  });

  it('uses the same continuity rejection for legal query and authoritative dispatch', () => {
    const ruleset = cycleRuleset();
    const state = createGame(cycleConfig, ruleset);
    const cardId = state.zones[baseZoneIds.monsterRow]!.cardIds.pop()!;
    availableTargetFor(state, cardId).status = 'removed';
    state.removedCards.push(cardId);
    expect(getLegalCommands(state, ruleset, 'p1')).toEqual([]);
    const result = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'invalid-continuity'));
    expect(result.error).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(result.error?.message).toContain('SUPPLY_CONTINUITY_VIOLATION');
  });
});
