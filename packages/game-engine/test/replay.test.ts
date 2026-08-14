import { describe, expect, it } from 'vitest';
import { createGame, createRuleset, dispatch, firstReplayDivergence, replayGame, replayRegistryFingerprint, serializeSnapshot, validateReplayBundleAgainstRuleset } from '../src/index.js';
import { testPack, testRuleset } from './fixtures.js';
import type { CommandEnvelope, LifecycleHook, ReplayBundle } from '@guildmaster/game-protocol';
import { baseRulesModule } from '../src/rules/base-rules.js';
import type { RulesModule } from '../src/rules/ruleset.js';

const initialConfig = { gameId: 'replay-game', seed: 31, players: [{ id: 'p1', name: '玩家', kind: 'human' as const }, { id: 'p2', name: 'AI', kind: 'ai' as const }], startingPlayerId: 'p1' };

function bundle(commands: readonly CommandEnvelope[] = []): ReplayBundle {
  return { schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(testRuleset), initialConfig, commands };
}

describe('versioned command replay', () => {
  it('rebuilds a deterministic final snapshot through authoritative dispatch without mutating inputs', () => {
    let state = createGame(initialConfig, testRuleset);
    const commands: CommandEnvelope[] = [];
    for (const phase of ['action1', 'combat', 'action2', 'purchase', 'rest'] as const) {
      const envelope: CommandEnvelope = { protocolVersion: 1, gameId: state.gameId, commandId: `p1-${phase}`, actorId: state.activePlayerId, expectedRevision: state.revision, command: { type: 'END_PHASE', phase } };
      const result = dispatch(state, testRuleset, envelope);
      expect(result.error).toBeUndefined();
      state = result.state;
      commands.push(envelope);
    }
    const original = bundle(commands);
    const frozen = structuredClone(original);
    const replay = replayGame(original, testRuleset);
    expect(replay).toMatchObject({ status: 'completed', finalSnapshot: serializeSnapshot(state) });
    expect(original).toEqual(frozen);
  });

  it('reports duplicate IDs, registry mismatch, stale revisions, and assertion mismatches precisely', () => {
    const duplicated = bundle([{ protocolVersion: 1, gameId: initialConfig.gameId, commandId: 'same', actorId: 'p1', expectedRevision: 0, command: { type: 'END_PHASE', phase: 'action1' } }, { protocolVersion: 1, gameId: initialConfig.gameId, commandId: 'same', actorId: 'p1', expectedRevision: 0, command: { type: 'END_PHASE', phase: 'action1' } }]);
    expect(validateReplayBundleAgainstRuleset(duplicated, testRuleset).diagnostic?.reasonCode).toBe('MALFORMED_BUNDLE');
    expect(replayGame({ ...bundle(), registry: { ...bundle().registry, engineVersion: 'different' } }, testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'REGISTRY_MISMATCH' } });
    expect(replayGame({ ...bundle(), schemaVersion: 99 } as unknown, testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'UNKNOWN_REPLAY_VERSION' } });
    const richAutomation = { profileId: 'base:cpu-balanced', profileVersion: '1.0.0', runner: { autonomousSteps: 0, turnActions: [], visibleStates: [] }, decisions: [] };
    expect(replayGame({ ...bundle(), schemaVersion: 1, automation: richAutomation } as unknown, testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'MALFORMED_BUNDLE' } });
    expect(replayGame(bundle([{ protocolVersion: 1, gameId: initialConfig.gameId, commandId: 'stale', actorId: 'p1', expectedRevision: 1, command: { type: 'END_PHASE', phase: 'action1' } }]), testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'COMMAND_REJECTED', commandIndex: 0, commandId: 'stale', expectedRevision: 1, actualRevision: 0, engineErrorCode: 'STALE_REVISION' } });
    expect(replayGame({ ...bundle(), expectedEvents: [] }, testRuleset)).toMatchObject({ status: 'completed' });
    expect(replayGame({ ...bundle([{ protocolVersion: 1, gameId: initialConfig.gameId, commandId: 'event', actorId: 'p1', expectedRevision: 0, command: { type: 'END_PHASE', phase: 'action1' } }]), expectedEvents: [{ eventId: 'wrong', revision: 0, type: 'WRONG', message: 'wrong' }] }, testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'EXPECTED_EVENTS_MISMATCH' } });
    const cyclic: Record<string, unknown> = bundle(); cyclic.self = cyclic;
    expect(replayGame(cyclic, testRuleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'MALFORMED_BUNDLE' } });
  });

  it('reports the first stable leaf for event and final-snapshot divergence', () => {
    expect(firstReplayDivergence({ b: 2, a: [1, 3] }, { a: [1, 4], b: 2 })).toEqual({ path: '$.a[1]', expected: 3, actual: 4 });
    const result = replayGame({ ...bundle(), expectedFinalSnapshot: { ...serializeSnapshot(createGame(initialConfig, testRuleset)), engineVersion: 'wrong' } }, testRuleset);
    expect(result).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'EXPECTED_FINAL_SNAPSHOT_MISMATCH', divergence: { path: '$.expectedFinalSnapshot.engineVersion', expected: 'wrong', actual: '0.2.0' } } });
  });

  it('records suspended transaction events only when the event cursor commits', () => {
    const hook: LifecycleHook = {
      schemaVersion: 1,
      moduleId: 'test:replay-continuation',
      hookId: 'choice-before',
      point: 'command-before',
      kind: 'trigger',
      priority: 1,
      effect: {
        schemaVersion: 1,
        effectId: 'test:replay-continuation/choice',
        body: { kind: 'choice', choiceId: 'replay-choice', actor: { kind: 'controller' }, options: [{ id: 'confirm', effect: { kind: 'modify-value', target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } }, amount: 1 } }] }
      }
    };
    const module: RulesModule = { id: 'test:replay-continuation', version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled', lifecycleHooks: [hook] };
    const ruleset = createRuleset([testPack], [baseRulesModule, module]);
    const config = { ...initialConfig, gameId: 'replay-continuation' };
    const commands: CommandEnvelope[] = [
      { protocolVersion: 1, gameId: config.gameId, commandId: 'choice-start', actorId: 'p1', expectedRevision: 0, command: { type: 'END_PHASE', phase: 'action1' } },
      {
        protocolVersion: 1,
        gameId: config.gameId,
        commandId: 'choice-resume',
        actorId: 'p1',
        expectedRevision: 0,
        command: {
          type: 'RESOLVE_EFFECT_CHOICE',
          executionId: 'lifecycle:command-before:0:choice-start:test:replay-continuation:choice-before',
          choiceId: 'replay-choice',
          optionId: 'confirm'
        }
      }
    ];
    const result = replayGame({ schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(ruleset), initialConfig: config, commands }, ruleset);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.events).toHaveLength(result.finalSnapshot.state.eventLogCursor);
    expect(new Set(result.events.map(({ eventId }) => eventId)).size).toBe(result.events.length);
    expect(result.events.map(({ type }) => type)).toEqual(['EFFECT_STARTED', 'EFFECT_SUSPENDED', 'EFFECT_VALUE_MODIFIED', 'EFFECT_COMPLETED', 'PHASE_ENDED']);
  });
});
