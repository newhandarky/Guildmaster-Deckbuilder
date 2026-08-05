import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseDemoContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createGame, createRuleset, dispatch, serializeSnapshot, type RulesModule } from '@guildmaster/game-engine';
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

function memoryStorage(options: { failReads?: boolean; failWrites?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => {
      if (options.failReads) throw new DOMException('Storage unavailable', 'SecurityError');
      return values.get(key) ?? null;
    },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      if (options.failWrites) throw new DOMException('Storage unavailable', 'QuotaExceededError');
      values.set(key, value);
    }
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

function seedPendingConsentSave(ruleset: ReturnType<typeof createRuleset>): void {
  const state = createGame({
    gameId: 'local-pending-consent',
    seed: 20260726,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1'
  }, ruleset);
  state.activePlayerId = 'ai-1';
  state.phase = 'rest';
  state.players[1]!.counters.push({ resourceId: 'test:session/token', amount: 3, visibility: 'allPlayersByConsent' });
  const suspended = dispatch(state, ruleset, {
    protocolVersion: 1,
    gameId: state.gameId,
    commandId: 'pending-consent-root',
    actorId: 'ai-1',
    expectedRevision: 0,
    command: { type: 'END_PHASE', phase: 'rest' }
  });
  if (suspended.error || !suspended.state.effectState.pendingCounterConsent) throw new Error('Expected a pending consent fixture.');
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(suspended.state), events: [] }));
}

describe('LocalGameSession transactional boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('reports a versioned JSON-only persistence lifecycle without changing game revisions', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    expect(session.current().persistence).toEqual({
      schemaVersion: 1,
      state: 'fresh',
      revision: 0,
      replayHistoryComplete: true,
    });

    const saved = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(saved.persistence).toEqual({
      schemaVersion: 1,
      state: 'saved',
      revision: saved.view.revision,
      replayHistoryComplete: true,
    });
    expect(JSON.parse(JSON.stringify(saved.persistence))).toEqual(saved.persistence);

    const restored = new LocalGameSession(ruleset).current();
    expect(restored.persistence).toEqual({
      schemaVersion: 1,
      state: 'restored',
      revision: saved.view.revision,
      replayHistoryComplete: true,
    });
    expect(restored.view).toMatchObject({ gameId: saved.view.gameId, revision: saved.view.revision });
  });

  it('marks snapshot-only saves as restored without fabricating replay history', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    seedConsentSave(ruleset);
    const restored = new LocalGameSession(ruleset).current();
    expect(restored.persistence).toMatchObject({
      schemaVersion: 1,
      state: 'restored',
      revision: 0,
      replayHistoryComplete: false,
    });
    expect(restored.replayHistoryComplete).toBe(false);
  });

  it('keeps accepted progress playable and separates storage failure from engine errors', () => {
    vi.stubGlobal('localStorage', memoryStorage({ failWrites: true }));
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const update = new LocalGameSession(ruleset).submit({ type: 'END_PHASE', phase: 'action1' });
    expect(update.error).toBeUndefined();
    expect(update.view).toMatchObject({ revision: 1, phase: 'combat' });
    expect(update.persistence).toEqual({
      schemaVersion: 1,
      state: 'memory-only',
      revision: 1,
      replayHistoryComplete: true,
    });
  });

  it('reports memory-only immediately when local storage cannot be read', () => {
    vi.stubGlobal('localStorage', memoryStorage({ failReads: true }));
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const current = new LocalGameSession(ruleset).current();
    expect(current.error).toBeUndefined();
    expect(current.view).toMatchObject({ revision: 0, phase: 'action1' });
    expect(current.persistence).toEqual({
      schemaVersion: 1,
      state: 'memory-only',
      revision: 0,
      replayHistoryComplete: true,
    });
  });

  it('returns action previews tied to the current game, actor, revision, and legal commands', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    const combat = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(combat.actionPreviews).toMatchObject({ schemaVersion: 1, gameId: combat.view.gameId, revision: combat.view.revision, actorId: 'human-1' });
    expect(combat.actionPreviews.items.length).toBeGreaterThan(0);
    expect(combat.actionPreviews.items.every(({ command }) => combat.legalCommands.some((legal) => JSON.stringify(legal) === JSON.stringify(command)))).toBe(true);
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

  it('restores pending consent and commits the original command once after a human decline', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule, module([hook('command-before', consent(modify(4)))])]);
    seedPendingConsentSave(ruleset);
    const session = new LocalGameSession(ruleset);
    const pending = session.current();
    expect(pending.view).toMatchObject({ revision: 0, pendingCounterConsent: { requestId: 'session-consent', requesterId: 'ai-1' } });
    expect(pending.legalCommands).toContainEqual({ type: 'RESPOND_COUNTER_CONSENT', requestId: 'session-consent', response: 'decline' });
    expect(pending.legalCommands.some(({ type }) => type === 'END_PHASE')).toBe(false);

    const completed = session.submit({ type: 'RESPOND_COUNTER_CONSENT', requestId: 'session-consent', response: 'decline' });
    expect(completed.error).toBeUndefined();
    expect(completed.view).toMatchObject({ revision: 1, activePlayerId: 'human-1' });
    expect(completed.view.pendingCounterConsent).toBeUndefined();
    expect(completed.events.filter(({ type }) => type === 'COUNTER_CONSENT_DECLINED')).toHaveLength(1);
    expect(completed.events.every(({ causedByCommandId }) => causedByCommandId === 'pending-consent-root')).toBe(true);
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    expect(saved.snapshot.state.eventLogCursor).toBe(saved.events.length);
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
