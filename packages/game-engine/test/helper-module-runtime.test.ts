import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@guildmaster/game-protocol';
import {
  baseRulesModule,
  createGame,
  createRuleset,
  dispatch,
  envelope,
  executeEffect,
  getPartyLimit,
  projectPlayerView,
  restoreSnapshot,
  serializeSnapshot,
  type RulesModule,
} from '../src/index.js';
import { baseZoneIds } from '../src/model/zones.js';
import { testPack } from './fixtures.js';

const helperZoneIds = {
  deck: 'test:helper-deck',
  active: 'test:helper-active',
  retired: 'test:helper-retired',
} as const;

const helperPack: ContentPack = {
  manifest: { id: 'test:helpers', version: '1.0.0', hash: 'test-helpers-v1', role: 'expansion', dependencies: [testPack.manifest.id] },
  definitions: Array.from({ length: 12 }, (_, index) => {
    const sequence = String(index + 1).padStart(2, '0');
    return { id: `test:helper/helper-${sequence}`, name: `Helper ${sequence}`, type: 'helper', copies: 1, source: 'test' };
  }),
};

function helperModule(policyId = 'test:enforce-helper-capacity'): RulesModule {
  return {
    id: 'test:helpers',
    version: '1.0.0',
    config: { enabledHelperDefinitionId: 'test:helper/helper-08' },
    composition: { schemaVersion: 1, kind: 'optional', priority: 10, dependencies: [{ moduleId: baseRulesModule.id, version: baseRulesModule.version }] },
    createInitialState: () => ({ schemaVersion: 1 }),
    validateState: (state) => state && typeof state === 'object' && !Array.isArray(state)
      && (state as Record<string, unknown>).schemaVersion === 1 && Object.keys(state).length === 1
      ? []
      : ['state must equal { schemaVersion: 1 }.'],
    zoneDefinitions: [
      { zoneId: helperZoneIds.deck, kind: 'orderedDeck', visibility: 'hidden', rulesModuleId: 'test:helpers' },
      { zoneId: helperZoneIds.active, kind: 'singleSlot', visibility: 'public', rulesModuleId: 'test:helpers' },
      { zoneId: helperZoneIds.retired, kind: 'moduleArea', visibility: 'public', rulesModuleId: 'test:helpers' },
    ],
    setupContributions: [{
      schemaVersion: 1,
      contributionId: 'test:helper-pool',
      moduleId: 'test:helpers',
      priority: 10,
      selector: { kind: 'definition-type', value: 'helper' },
      count: { kind: 'zone-card-count', zoneIds: [baseZoneIds.bossDeck, baseZoneIds.bossRow] },
      destinationZoneId: helperZoneIds.deck,
      order: 'deterministic-shuffle',
    }],
    supplyRowConfigurations: [{
      schemaVersion: 1,
      configurationId: 'test:helper-row',
      moduleId: 'test:helpers',
      priority: 10,
      supply: 'test:helper',
      sourceDeckZoneId: helperZoneIds.deck,
      targetRowZoneId: helperZoneIds.active,
      targetSize: 1,
      mode: 'refill-to-target',
    }],
    supplyRowRefreshPolicies: [{
      schemaVersion: 1,
      refreshPolicyId: 'test:rotate-helper',
      moduleId: 'test:helpers',
      priority: 10,
      supplyRowConfigurationId: 'test:helper-row',
      destinationZoneId: helperZoneIds.retired,
      ordering: 'preserve-top',
      refill: true,
      reasonCode: 'BOSS_DEFEATED',
    }],
    teamCapacityEnforcementPolicies: policyId === 'missing'
      ? []
      : [{ schemaVersion: 1, policyId, moduleId: 'test:helpers', priority: 10, playerScope: 'all-players', mode: 'discard-newest', reasonCode: 'HELPER_LEFT' }],
    lifecycleHooks: [{
      schemaVersion: 1,
      hookId: 'rotate-after-boss',
      moduleId: 'test:helpers',
      point: 'event-after',
      kind: 'trigger',
      eventType: 'ENEMY_DEFEATED',
      priority: 100,
      activation: { kind: 'metadata-equals', key: 'targetKind', value: 'boss' },
      effect: {
        schemaVersion: 1,
        effectId: 'test:helpers/rotate-after-boss',
        body: { kind: 'sequence', effects: [{ kind: 'refresh-supply-row', refreshPolicyId: 'test:rotate-helper' }, { kind: 'enforce-team-capacity', policyId }] },
      },
    }],
    getPartyLimit: (state, _player, limit) => {
      const activeId = state.zones[helperZoneIds.active]?.cardIds[0];
      return activeId && state.cards[activeId]?.definitionId === 'test:helper/helper-08' ? limit + 1 : limit;
    },
    onSupplyDepleted: () => 'handled',
  };
}

const config = {
  gameId: 'helper-runtime',
  seed: 73,
  players: [{ id: 'p1', name: 'P1', kind: 'human' as const }, { id: 'p2', name: 'P2', kind: 'ai' as const }],
  startingPlayerId: 'p1',
};

function ruleset(policyId?: string) {
  return createRuleset([testPack, helperPack], [baseRulesModule, helperModule(policyId)], { allowProvisionalPlaytest: true });
}

function forceHelper08Active(state: ReturnType<typeof createGame>): void {
  const active = state.zones[helperZoneIds.active]!.cardIds;
  const deck = state.zones[helperZoneIds.deck]!.cardIds;
  const helper08 = [...active, ...deck].find((cardId) => state.cards[cardId]!.definitionId === 'test:helper/helper-08');
  if (!helper08) throw new Error('The deterministic test sample must include helper 08.');
  if (active[0] !== helper08) {
    const deckIndex = deck.indexOf(helper08);
    const current = active[0]!;
    deck.splice(deckIndex, 1, current);
    active[0] = helper08;
  }
  const nextNon08 = deck.findIndex((cardId) => state.cards[cardId]!.definitionId !== 'test:helper/helper-08');
  if (nextNon08 >= 0) deck.push(...deck.splice(nextNon08, 1));
}

function gameContainingHelper08(activeRuleset: ReturnType<typeof ruleset>) {
  for (let seed = 1; seed <= 256; seed += 1) {
    const state = createGame({ ...config, seed }, activeRuleset);
    const selected = [...state.zones[helperZoneIds.active]!.cardIds, ...state.zones[helperZoneIds.deck]!.cardIds];
    if (selected.some((cardId) => state.cards[cardId]!.definitionId === 'test:helper/helper-08')) return state;
  }
  throw new Error('No deterministic seed selected helper 08 within the test budget.');
}

describe('generic helper Rules Module runtime', () => {
  it('samples one helper per boss deterministically and hides the remaining deck', () => {
    const activeRuleset = ruleset();
    const first = createGame(config, activeRuleset);
    const second = createGame(config, activeRuleset);
    expect(first.zones[helperZoneIds.deck]!.cardIds).toEqual(second.zones[helperZoneIds.deck]!.cardIds);
    expect(first.zones[helperZoneIds.active]!.cardIds).toEqual(second.zones[helperZoneIds.active]!.cardIds);
    expect(first.setupSelections).toEqual(second.setupSelections);
    expect(first.setupSelections?.['test:helper-pool']?.cardIds).toHaveLength(4);
    expect(first.zones[helperZoneIds.deck]!.cardIds).toHaveLength(3);
    expect(first.zones[helperZoneIds.active]!.cardIds).toHaveLength(1);
    expect(new Set([...first.zones[helperZoneIds.deck]!.cardIds, ...first.zones[helperZoneIds.active]!.cardIds])).toHaveLength(4);
    const view = projectPlayerView(first, activeRuleset, 'p1');
    expect(view.zones[helperZoneIds.deck]).toBeUndefined();
    expect(Object.keys(view.cards)).not.toEqual(expect.arrayContaining(first.zones[helperZoneIds.deck]!.cardIds));
    expect(() => restoreSnapshot(serializeSnapshot(first))).toThrow(/hidden Rules Module zones requires the active ruleset/);
    expect(restoreSnapshot(serializeSnapshot(first), activeRuleset)).toEqual(first);
    const signatures = new Set(Array.from({ length: 8 }, (_, index) => {
      const candidate = createGame({ ...config, seed: index + 1 }, activeRuleset);
      return JSON.stringify([
        candidate.zones[helperZoneIds.active]!.cardIds.map((id) => candidate.cards[id]!.definitionId),
        candidate.zones[helperZoneIds.deck]!.cardIds.map((id) => candidate.cards[id]!.definitionId),
      ]);
    }));
    expect(signatures.size).toBeGreaterThan(1);
  });

  it('rejects controller effects that select a card from the hidden helper deck', () => {
    const activeRuleset = ruleset();
    const state = createGame(config, activeRuleset);
    const before = structuredClone(state);
    const cardId = state.zones[helperZoneIds.deck]!.cardIds.at(-1)!;
    const result = executeEffect(state, activeRuleset, {
      schemaVersion: 1,
      effectId: 'test:helpers/illegal-hidden-selection',
      body: {
        kind: 'move-card',
        card: { kind: 'context-card', key: 'hidden-helper' },
        from: { kind: 'shared-zone', zoneId: helperZoneIds.deck },
        to: { kind: 'removed' },
      },
    }, { controllerId: 'p1', cardRefs: { 'hidden-helper': cardId } }, 'hidden-helper-selection');
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('hidden') });
    expect(state).toEqual(before);
  });

  it('rotates only after a boss defeat and immediately discards the rightmost overflow member with equipment', () => {
    const activeRuleset = ruleset();
    const state = gameContainingHelper08(activeRuleset);
    forceHelper08Active(state);
    expect(getPartyLimit(activeRuleset, state, state.players[0]!)).toBe(6);
    const player = state.players[0]!;
    const extraAdventurer = state.zones[baseZoneIds.adventurerDeck]!.cardIds.pop()!;
    const equipmentIndex = state.zones[baseZoneIds.itemDeck]!.cardIds.findIndex((cardId) => activeRuleset.registry.definitions[state.cards[cardId]!.definitionId]!.type === 'equipment');
    const [equipmentId] = state.zones[baseZoneIds.itemDeck]!.cardIds.splice(equipmentIndex, 1);
    if (!equipmentId) throw new Error('Test setup requires an equipment card.');
    player.party.push({ adventurerId: extraAdventurer, equipmentId });
    player.turnCombatBonus = 99;
    state.phase = 'combat';
    const retiredBefore = [...state.zones[helperZoneIds.retired]!.cardIds];
    const bossTarget = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const result = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: bossTarget.targetId }, 'defeat-boss'));
    expect(result.error).toBeUndefined();
    expect(result.state.zones[helperZoneIds.retired]!.cardIds).toHaveLength(retiredBefore.length + 1);
    expect(result.state.players[0]!.party).toHaveLength(5);
    expect(result.state.players[0]!.discardPile.slice(-2)).toEqual([extraAdventurer, equipmentId]);
    expect(result.events.some(({ type }) => type === 'PARTY_MEMBER_DISCARDED')).toBe(true);
    expect(getPartyLimit(activeRuleset, result.state, result.state.players[0]!)).toBe(5);
  });

  it('does not rotate on a monster defeat', () => {
    const activeRuleset = ruleset();
    const state = createGame(config, activeRuleset);
    const activeBefore = [...state.zones[helperZoneIds.active]!.cardIds];
    state.players[0]!.turnCombatBonus = 99;
    state.phase = 'combat';
    const monsterTarget = Object.values(state.enemyTargets).find(({ kind }) => kind === 'monster')!;
    const result = dispatch(state, activeRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: monsterTarget.targetId }, 'defeat-monster'));
    expect(result.error).toBeUndefined();
    expect(result.state.zones[helperZoneIds.active]!.cardIds).toEqual(activeBefore);
    expect(result.state.zones[helperZoneIds.retired]!.cardIds).toHaveLength(0);
  });

  it('rolls the whole attack back when a post-refresh capacity policy is invalid', () => {
    const invalidRuleset = ruleset('missing');
    const state = createGame(config, invalidRuleset);
    state.players[0]!.turnCombatBonus = 99;
    state.phase = 'combat';
    const before = structuredClone(state);
    const bossTarget = Object.values(state.enemyTargets).find(({ kind }) => kind === 'boss')!;
    const result = dispatch(state, invalidRuleset, envelope(state, 'p1', { type: 'ATTACK_TARGET', targetId: bossTarget.targetId }, 'rollback-boss'));
    expect(result.error?.message).toMatch(/Unknown team capacity enforcement policy/);
    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
  });

  it('rejects malformed setup ownership, duplicate priorities, and zone card tampering', () => {
    expect(() => createRuleset([testPack, helperPack], [baseRulesModule, {
      ...helperModule(),
      setupContributions: [{ ...helperModule().setupContributions![0]!, contributionId: ' test:helper-pool' }],
    }], { allowProvisionalPlaytest: true })).toThrow(/surrounding whitespace/);
    expect(() => createRuleset([testPack, helperPack], [baseRulesModule, {
      ...helperModule(),
      setupContributions: [{ ...helperModule().setupContributions![0]!, moduleId: 'wrong' }],
    }], { allowProvisionalPlaytest: true })).toThrow(/must belong to module/);
    expect(() => createRuleset([testPack, helperPack], [baseRulesModule, {
      ...helperModule(),
      setupContributions: [{ ...helperModule().setupContributions![0]!, destinationZoneId: 'test:missing-zone' }],
    }], { allowProvisionalPlaytest: true })).toThrow(/unknown destination zone/);
    expect(() => createRuleset([testPack, helperPack], [baseRulesModule, {
      ...helperModule(),
      setupContributions: [{ ...helperModule().setupContributions![0]!, selector: { kind: 'definition-type', value: 'missing-type' } }],
    }], { allowProvisionalPlaytest: true })).toThrow(/selector has no matching definitions/);
    expect(() => createRuleset([testPack, helperPack], [baseRulesModule, helperModule(), {
      ...helperModule(), id: 'test:helpers-2', composition: { schemaVersion: 1, kind: 'optional', priority: 20 },
      zoneDefinitions: [], setupContributions: [], supplyRowConfigurations: [], supplyRowRefreshPolicies: [], lifecycleHooks: [],
      teamCapacityEnforcementPolicies: [{ ...helperModule().teamCapacityEnforcementPolicies![0]!, moduleId: 'test:helpers-2', policyId: 'test:second-policy' }],
    }], { allowProvisionalPlaytest: true })).toThrow(/priority 10 is ambiguous/);
    const activeRuleset = ruleset();
    const state = createGame(config, activeRuleset);
    const foreign = state.zones[baseZoneIds.itemDeck]!.cardIds.pop()!;
    const displaced = state.zones[helperZoneIds.deck]!.cardIds.pop()!;
    state.zones[baseZoneIds.itemDeck]!.cardIds.push(displaced);
    state.zones[helperZoneIds.deck]!.cardIds.push(foreign);
    expect(() => restoreSnapshot(serializeSnapshot(state), activeRuleset)).toThrow(/non-matching card|left its registered zones/);

    const insufficientPack: ContentPack = {
      ...helperPack,
      manifest: { ...helperPack.manifest, id: 'test:few-helpers', hash: 'few-helpers' },
      definitions: helperPack.definitions.slice(0, 3),
    };
    const insufficientRuleset = createRuleset([testPack, insufficientPack], [baseRulesModule, helperModule()], { allowProvisionalPlaytest: true });
    expect(() => createGame(config, insufficientRuleset)).toThrow(/requires 4 cards but only 3 candidates exist/);
  });

  it('rejects deleted setup selections and invalid helper module state during restore', () => {
    const activeRuleset = ruleset();
    const state = createGame(config, activeRuleset);
    const deleted = structuredClone(state);
    const deletedCardId = deleted.zones[helperZoneIds.deck]!.cardIds.pop()!;
    delete deleted.cards[deletedCardId];
    expect(() => restoreSnapshot(serializeSnapshot(deleted), activeRuleset)).toThrow(/recorded cards|recorded definition/);

    const substituted = structuredClone(state);
    const selectedId = substituted.setupSelections!['test:helper-pool']!.cardIds[0]!;
    const selectedIndex = substituted.setupSelections!['test:helper-pool']!.cardIds.indexOf(selectedId);
    const replacementDefinitionId = helperPack.definitions.find(({ id }) => id !== substituted.cards[selectedId]!.definitionId)!.id;
    substituted.cards[selectedId]!.definitionId = replacementDefinitionId;
    expect(() => restoreSnapshot(serializeSnapshot(substituted), activeRuleset)).toThrow(/recorded definition/);

    const coordinatedSubstitution = structuredClone(substituted);
    coordinatedSubstitution.setupSelections!['test:helper-pool']!.definitionIds[selectedIndex] = replacementDefinitionId;
    expect(() => restoreSnapshot(serializeSnapshot(coordinatedSubstitution), activeRuleset)).toThrow(/canonical seed replay/);

    const invalidModuleState = structuredClone(state);
    invalidModuleState.moduleState['test:helpers'] = { schemaVersion: 1, activeHelperId: 'tampered' };
    expect(() => restoreSnapshot(serializeSnapshot(invalidModuleState), activeRuleset)).toThrow(/Rules Module state test:helpers is invalid/);
  });

  it('keeps setup selection validity independent from mutable count zones', () => {
    const activeRuleset = ruleset();
    const state = createGame(config, activeRuleset);
    const bossCardId = state.zones[baseZoneIds.bossDeck]!.cardIds.at(-1)!;
    const moved = executeEffect(state, activeRuleset, {
      schemaVersion: 1,
      effectId: 'test:move-counted-boss',
      body: {
        kind: 'move-card',
        card: { kind: 'card-instance', cardInstanceId: bossCardId },
        from: { kind: 'shared-zone', zoneId: baseZoneIds.bossDeck },
        to: { kind: 'removed' },
      },
    }, { controllerId: 'p1' }, 'move-counted-boss');
    expect(moved.status).toBe('completed');
    expect(restoreSnapshot(serializeSnapshot(state), activeRuleset)).toEqual(state);
  });
});
