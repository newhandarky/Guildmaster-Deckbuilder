import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@guildmaster/game-protocol';
import { createGame, createRuleset, dispatch, envelope, getLegalCommands, projectPlayerView, restoreSnapshot, serializeSnapshot } from '../src/index.js';
import { baseRulesModule } from '../src/rules/base-rules.js';
import { baseZoneIds } from '../src/model/zones.js';
import type { RulesModule } from '../src/rules/ruleset.js';
import { makeGame, testPack, testRuleset } from './fixtures.js';

const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, kind: index === 0 ? 'human' as const : 'ai' as const }));
const setupPack: ContentPack = {
  ...testPack,
  manifest: { ...testPack.manifest, id: 'test:bond-setup', hash: 'bond-setup' },
  definitions: [...testPack.definitions,
    { id: 'test:boss/e', name: 'E', type: 'boss', copies: 1, combat: 4, source: 'test' },
    { id: 'test:boss/f', name: 'F', type: 'boss', copies: 1, combat: 4, source: 'test' }],
  bonds: Array.from({ length: 30 }, (_, index) => ({ id: `test:bond/${String(index + 1).padStart(2, '0')}`, name: `Bond ${index + 1}`, honor: (index % 5) + 1, requiredBosses: 99 })),
};

describe('four-player setup and market refresh commands', () => {
  it('deals seven private bonds and accepts exactly five from each authoritative offer', () => {
    const ruleset = createRuleset([setupPack], [baseRulesModule]);
    let state = createGame({ gameId: 'bond-setup', seed: 17, players, startingPlayerId: 'p1' }, ruleset);
    expect(state.status).toBe('setup');
    expect(Object.values(state.bondSetup!.offers).flat()).toHaveLength(28);
    expect(new Set(Object.values(state.bondSetup!.offers).flat()).size).toBe(28);
    expect(getLegalCommands(state, ruleset, 'p1')).toHaveLength(21);
    expect(getLegalCommands(state, ruleset, 'p2')).toEqual([]);
    expect(projectPlayerView(state, ruleset, 'p1').bondSetup?.offeredBondIds).toHaveLength(7);
    expect(projectPlayerView(state, ruleset, 'p2').bondSetup?.offeredBondIds).toBeUndefined();

    for (const player of players) {
      const legal = getLegalCommands(state, ruleset, player.id);
      expect(legal[0]?.type).toBe('SELECT_BONDS');
      const result = dispatch(state, ruleset, envelope(state, player.id, legal[0]!));
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    expect(state.status).toBe('playing');
    expect(state.bondSetup).toBeUndefined();
    expect(state.activePlayerId).toBe('p1');
    expect(state.players.every(({ bonds }) => bonds.length === 5)).toBe(true);
  });

  it('round-trips setup and rejects an offer that diverges from canonical seed replay', () => {
    const ruleset = createRuleset([setupPack], [baseRulesModule]);
    const state = createGame({ gameId: 'bond-snapshot', seed: 23, players }, ruleset);
    expect(restoreSnapshot(serializeSnapshot(state), ruleset)).toEqual(state);
    const tampered = structuredClone(serializeSnapshot(state));
    [tampered.state.bondSetup!.offers.p1![0], tampered.state.bondSetup!.offers.p2![0]] = [tampered.state.bondSetup!.offers.p2![0]!, tampered.state.bondSetup!.offers.p1![0]!];
    expect(() => restoreSnapshot(tampered, ruleset)).toThrow(/canonical seed replay/);
  });

  it('refreshes one public market row atomically and only once per turn', () => {
    const state = makeGame();
    state.phase = 'purchase';
    const player = state.players[0]!;
    const discardCardId = player.hand[0]!;
    const refreshCardIds = state.zones[baseZoneIds.itemRow]!.cardIds.slice(0, 2);
    const beforeRng = state.rngState;
    const command = { type: 'REFRESH_MARKET' as const, row: 'item' as const, discardCardId, refreshCardIds };
    expect(getLegalCommands(state, testRuleset, player.id)).toContainEqual(command);
    const result = dispatch(state, testRuleset, envelope(state, player.id, command));
    expect(result.error).toBeUndefined();
    expect(result.state.rngState).not.toBe(beforeRng);
    expect(result.state.players[0]!.discardPile).toContain(discardCardId);
    expect(result.state.players[0]!.turnMarketRefreshed).toBe(true);
    expect(result.state.turnFacts).toMatchObject({ playerId: 'p1', marketRefreshed: true });
    expect(result.state.zones[baseZoneIds.itemRow]!.cardIds).toHaveLength(3);
    expect(getLegalCommands(result.state, testRuleset, player.id).some(({ type }) => type === 'REFRESH_MARKET')).toBe(false);
  });

  it('rolls back a stale market subset without consuming RNG or cards', () => {
    const state = makeGame();
    state.phase = 'purchase';
    const before = structuredClone(state);
    const result = dispatch(state, testRuleset, envelope(state, 'p1', { type: 'REFRESH_MARKET', row: 'item', discardCardId: state.players[0]!.hand[0]!, refreshCardIds: ['not-in-row'] }));
    expect(result.error?.code).toBe('INVALID_COMMAND');
    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
  });

  it('round-trips consecutive phase-end and phase-start choice suspensions in one transition transaction', () => {
    const choice = (choiceId: string) => ({ kind: 'choice' as const, choiceId, actor: { kind: 'controller' as const }, options: [{ id: 'continue', effect: { kind: 'modify-value' as const, target: { kind: 'turn-purchase-bonus' as const, player: { kind: 'controller' as const } }, amount: 0 } }] });
    const transitionModule: RulesModule = {
      id: 'test:phase-transition', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
      lifecycleHooks: [
        { schemaVersion: 1, moduleId: 'test:phase-transition', hookId: 'phase-end-choice', point: 'phase-end', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'test:phase-transition/phase-end', body: choice('phase-end-choice') } },
        { schemaVersion: 1, moduleId: 'test:phase-transition', hookId: 'phase-start-choice', point: 'phase-start', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: 'test:phase-transition/phase-start', body: choice('phase-start-choice') } },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, transitionModule]);
    const initial = createGame({ gameId: 'phase-transition-choice', seed: 71, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const first = dispatch(initial, ruleset, envelope(initial, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'phase-root'));
    expect(first.error).toBeUndefined();
    expect(first.state).toMatchObject({ revision: 0, phase: 'action1', effectState: { pendingCommand: { kind: 'phase-transition', cursor: 'after-phase-end' } } });
    let restored = restoreSnapshot(serializeSnapshot(first.state), ruleset);
    const firstChoice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const second = dispatch(restored, ruleset, envelope(restored, 'p1', firstChoice, 'phase-end-resolution'));
    expect(second.error).toBeUndefined();
    expect(second.state).toMatchObject({ revision: 0, phase: 'combat', effectState: { pendingCommand: { kind: 'phase-transition', cursor: 'complete-nonrest' } } });
    restored = restoreSnapshot(serializeSnapshot(second.state), ruleset);
    const secondChoice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', secondChoice, 'phase-start-resolution'));
    expect(completed.error).toBeUndefined();
    expect(completed.state).toMatchObject({ revision: 1, phase: 'combat', effectState: {} });
    expect(completed.events.filter(({ type }) => type === 'PHASE_ENDED')).toHaveLength(1);
  });

  it('records every actor response when phase lifecycle consent re-suspends', () => {
    const moduleId = 'test:phase-consent';
    const transitionModule: RulesModule = {
      id: moduleId, version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
      counterConsentPolicies: [{ schemaVersion: 1, moduleId, policyId: 'phase-consent-policy', resourceId: `${moduleId}:audit`, requester: 'counter-owner', requiredConsent: 'all-other-players', expiration: { kind: 'explicit-command', actor: 'any-player' } }],
      lifecycleHooks: [{
        schemaVersion: 1, moduleId, hookId: 'phase-end-consent', point: 'phase-end', kind: 'trigger', priority: 1,
        effect: { schemaVersion: 1, effectId: `${moduleId}:phase-end`, body: {
          kind: 'request-counter-consent', requestId: 'phase-consent', policy: { moduleId, policyId: 'phase-consent-policy' }, counterOwner: { kind: 'controller' },
          outcomes: {
            accepted: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
            declined: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
            cancelled: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
            expired: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 0 },
          },
        } },
      }],
    };
    const ruleset = createRuleset([setupPack], [baseRulesModule, transitionModule]);
    let state = createGame({ gameId: 'phase-transition-consent', seed: 73, players, startingPlayerId: 'p1' }, ruleset);
    for (const player of players) state = dispatch(state, ruleset, envelope(state, player.id, getLegalCommands(state, ruleset, player.id)[0]!)).state;
    state.players[0]!.counters.push({ resourceId: `${moduleId}:audit`, amount: 1, visibility: 'allPlayersByConsent' });
    const root = dispatch(state, ruleset, envelope(state, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'phase-consent-root'));
    expect(root.error).toBeUndefined();
    state = root.state;
    for (const actorId of ['p2', 'p3']) {
      state = restoreSnapshot(serializeSnapshot(state), ruleset);
      const response = getLegalCommands(state, ruleset, actorId).find((command) => command.type === 'RESPOND_COUNTER_CONSENT' && command.response === 'accept')!;
      const accepted = dispatch(state, ruleset, envelope(state, actorId, response, `phase-consent-${actorId}`));
      expect(accepted.error).toBeUndefined();
      expect(accepted.state.effectState.pendingCounterConsent?.acceptedActorIds).toContain(actorId);
      state = accepted.state;
    }
    state = restoreSnapshot(serializeSnapshot(state), ruleset);
    const finalResponse = getLegalCommands(state, ruleset, 'p4').find((command) => command.type === 'RESPOND_COUNTER_CONSENT' && command.response === 'accept')!;
    const completed = dispatch(state, ruleset, envelope(state, 'p4', finalResponse, 'phase-consent-p4'));
    expect(completed.error).toBeUndefined();
    expect(completed.state).toMatchObject({ revision: 5, phase: 'combat', effectState: {} });
  });

  it('keeps a phase-transition suspension reached after command-before resolution', () => {
    const choice = (choiceId: string) => ({ kind: 'choice' as const, choiceId, actor: { kind: 'controller' as const }, options: [{ id: 'continue', effect: { kind: 'modify-value' as const, target: { kind: 'turn-purchase-bonus' as const, player: { kind: 'controller' as const } }, amount: 0 } }] });
    const moduleId = 'test:command-before-phase';
    const transitionModule: RulesModule = {
      id: moduleId, version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
      lifecycleHooks: [
        { schemaVersion: 1, moduleId, hookId: 'before', point: 'command-before', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: `${moduleId}:before`, body: choice('before') } },
        { schemaVersion: 1, moduleId, hookId: 'phase-end', point: 'phase-end', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: `${moduleId}:phase-end`, body: choice('phase-end') } },
      ],
    };
    const ruleset = createRuleset([testPack], [baseRulesModule, transitionModule]);
    const initial = createGame({ gameId: 'command-before-phase', seed: 79, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, ruleset);
    const before = dispatch(initial, ruleset, envelope(initial, 'p1', { type: 'END_PHASE', phase: 'action1' }, 'before-phase-root'));
    const beforeChoice = getLegalCommands(before.state, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const phase = dispatch(before.state, ruleset, envelope(before.state, 'p1', beforeChoice, 'before-phase-resolution'));
    expect(phase.error).toBeUndefined();
    expect(phase.state.effectState.pendingCommand).toMatchObject({ kind: 'phase-transition', resolutionEnvelopes: [{ commandId: 'before-phase-resolution' }] });
    const restored = restoreSnapshot(serializeSnapshot(phase.state), ruleset);
    const phaseChoice = getLegalCommands(restored, ruleset, 'p1').find((command) => command.type === 'RESOLVE_EFFECT_CHOICE')!;
    const completed = dispatch(restored, ruleset, envelope(restored, 'p1', phaseChoice, 'phase-end-resolution'));
    expect(completed.error).toBeUndefined();
    expect(completed.state).toMatchObject({ revision: 1, phase: 'combat', effectState: {} });
  });
});
