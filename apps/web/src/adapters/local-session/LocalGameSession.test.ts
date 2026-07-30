import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseDemoContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createGame, createRuleset, serializeSnapshot, type RulesModule } from '@guildmaster/game-engine';
import type { EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { LocalGameSession } from './LocalGameSession.js';

const storageKey = 'guildmaster-mvp-save-v2';
const modify = (amount: number): EffectDefinition['body'] => ({
  kind: 'modify-value',
  target: { kind: 'turn-purchase-bonus', player: { kind: 'controller' } },
  amount
});
const hook = (point: LifecycleHook['point'], body: EffectDefinition['body']): LifecycleHook => ({
  schemaVersion: 1,
  moduleId: 'test:session',
  hookId: `session-${point}`,
  point,
  kind: 'trigger',
  priority: 1,
  effect: { schemaVersion: 1, effectId: `test:session/${point}`, body }
});
const module = (lifecycleHooks: readonly LifecycleHook[]): RulesModule => ({
  id: 'test:session',
  version: '1',
  getPartyLimit: (_state, _player, limit) => limit,
  onSupplyDepleted: () => 'handled',
  lifecycleHooks,
  counterConsentPolicies: [{
    schemaVersion: 1,
    moduleId: 'test:session',
    policyId: 'share-token',
    resourceId: 'test:session/token',
    requester: 'counter-owner',
    requiredConsent: 'all-other-players',
    expiration: { kind: 'explicit-command', actor: 'any-player' }
  }]
});
const consent = (accepted: EffectDefinition['body']): EffectDefinition['body'] => ({
  kind: 'request-counter-consent',
  requestId: 'session-consent',
  policy: { moduleId: 'test:session', policyId: 'share-token' },
  counterOwner: { kind: 'controller' },
  outcomes: { accepted, declined: modify(0), cancelled: modify(0), expired: modify(0) }
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

function seedConsentSave(ruleset: ReturnType<typeof createRuleset>): void {
  const state = createGame({
    gameId: 'local-1',
    seed: 20260726,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1'
  }, ruleset);
  state.players[0]!.counters.push({ resourceId: 'test:session/token', amount: 3, visibility: 'allPlayersByConsent' });
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(state), events: [] }));
}

describe('LocalGameSession transactional boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('records one committed audit after choice suspension and never duplicates suspended events', () => {
    const choice: EffectDefinition['body'] = {
      kind: 'choice',
      choiceId: 'session-choice',
      actor: { kind: 'controller' },
      options: [{ id: 'continue', effect: modify(2) }]
    };
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule, module([hook('command-before', choice)])]);
    const session = new LocalGameSession(ruleset);
    const suspended = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(suspended.error).toBeUndefined();
    expect(suspended.view.revision).toBe(0);
    expect(suspended.events).toEqual([]);

    const command = suspended.legalCommands.find(({ type }) => type === 'RESOLVE_EFFECT_CHOICE');
    if (!command) throw new Error('Expected the session choice continuation.');
    const completed = session.submit(command);
    expect(completed.error).toBeUndefined();
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    expect(saved.replayBundle.expectedEvents).toEqual(completed.events);
    expect(saved.replayBundle.expectedEvents).toHaveLength(saved.snapshot.state.eventLogCursor);
    expect(new Set(saved.replayBundle.expectedEvents.map((event: { eventId: string }) => event.eventId)).size).toBe(saved.replayBundle.expectedEvents.length);
  });

  it('lets an eligible non-active AI answer consent and commits the root command once', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule, module([hook('command-before', consent(modify(4)))])]);
    seedConsentSave(ruleset);
    const completed = new LocalGameSession(ruleset).submit({ type: 'END_PHASE', phase: 'action1' });
    expect(completed.error).toBeUndefined();
    expect(completed.view).toMatchObject({ revision: 1, phase: 'combat' });
    expect(completed.view.pendingCounterConsent).toBeUndefined();
    expect(completed.events.filter(({ type }) => type === 'COUNTER_CONSENT_ACCEPTED')).toHaveLength(1);
    expect(completed.events.every(({ causedByCommandId }) => causedByCommandId === 'human-1-1-1')).toBe(true);
  });

  it('persists the engine rollback checkpoint and removes the abandoned transaction history', () => {
    const invalidMove: EffectDefinition['body'] = {
      kind: 'move-card',
      card: { kind: 'card-instance', cardInstanceId: 'missing' },
      from: { kind: 'removed' },
      to: { kind: 'removed' }
    };
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule, module([hook('command-after', consent(invalidMove))])]);
    seedConsentSave(ruleset);
    const failed = new LocalGameSession(ruleset).submit({ type: 'END_PHASE', phase: 'action1' });
    expect(failed.error?.code).toBe('INVALID_COMMAND');
    expect(failed.view).toMatchObject({ revision: 0, phase: 'action1' });
    expect(failed.view.pendingCounterConsent).toBeUndefined();
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    expect(saved.snapshot.state).toMatchObject({ revision: 0, phase: 'action1', eventLogCursor: 0, effectState: {} });
  });

  it('does not export seed or hidden authoritative state before the game is finished', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const exported = new LocalGameSession(ruleset).exportReplayDiagnostic();
    expect(exported.json).toBeUndefined();
    expect(exported.error).toMatch(/只能在對局結束後匯出/);
  });
});
