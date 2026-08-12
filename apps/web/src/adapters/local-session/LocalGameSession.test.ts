import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseDemoContentPack, baseProvisionalFoundationContentPack } from '@guildmaster/content-base';
import { baseRulesModule, createGame, createRuleset, dispatch, serializeSnapshot, type RulesModule } from '@guildmaster/game-engine';
import type { EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import { LocalGameSession } from './LocalGameSession.js';
import { createWebRuleset } from '../../app/ruleset.js';

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
  state.turnFacts = { schemaVersion: 1, playerId: 'ai-1', adventurersRecruited: 0, adventurersAddedToParty: 0, itemsBought: 0, equipmentBought: 0, purchasePowerSpent: 0, extraCardsDrawn: 0, itemsUsed: 0, bossesDefeated: 0, monstersDefeated: 0, marketRefreshed: false, combatResolved: false, combatSkipped: false };
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

  it('runs a full four-player bond setup one deterministic CPU command at a time', () => {
    const session = new LocalGameSession(createWebRuleset(undefined, 'provisional-original-full'));
    const initial = session.current();
    expect(initial.view.status).toBe('setup');
    expect(initial.view.opponents).toHaveLength(3);
    const humanChoice = initial.legalCommands.find(({ type }) => type === 'SELECT_BONDS');
    if (!humanChoice) throw new Error('Expected human bond setup command.');
    let update = session.submit(humanChoice);
    expect(update.view.activePlayerId).toBe('ai-1');
    expect(update.cpu.status).toBe('ready');
    update = session.stepCpu();
    expect(update.view.activePlayerId).toBe('ai-2');
    update = session.stepCpu();
    expect(update.view.activePlayerId).toBe('ai-3');
    update = session.stepCpu();
    expect(update.view).toMatchObject({ status: 'playing', activePlayerId: 'human-1', revision: 4 });
    expect(update.cpu.decisions).toHaveLength(3);
    expect(update.cpu.decisions.every(({ command, reasonCode }) => command.type === 'SELECT_BONDS' && reasonCode === 'KEEP_HIGHEST_BOND_VALUE')).toBe(true);
  });

  it('finishes a deterministic four-player provisional expedition without illegal CPU commands', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    let session = new LocalGameSession(ruleset);
    let update = session.current();
    const chooseHumanCommand = () => {
      const legal = update.legalCommands;
      const choice = legal.find(({ type }) => type === 'SELECT_BONDS' || type === 'RESOLVE_EFFECT_CHOICE' || type === 'RESPOND_COUNTER_CONSENT');
      if (choice) return choice;
      const attack = legal.filter((command): command is Extract<typeof command, { type: 'ATTACK_TARGET' }> => command.type === 'ATTACK_TARGET').sort((left, right) => {
        const targetValue = (targetId: string) => { const target = update.view.enemyTargets[targetId]; const definition = target ? update.definitions[update.view.cards[target.cardInstanceId]?.definitionId ?? ''] : undefined; return (target?.kind === 'boss' ? 10_000 : 0) + (definition?.honor ?? 0) * 100; };
        return targetValue(right.targetId) - targetValue(left.targetId);
      })[0];
      if (attack) return attack;
      for (const type of ['PLAY_ADVENTURER', 'EQUIP_ITEM', 'USE_ITEM'] as const) { const command = legal.find((candidate) => candidate.type === type); if (command) return command; }
      const buys = legal.filter((command): command is Extract<typeof command, { type: 'BUY_CARD' }> => command.type === 'BUY_CARD').sort((left, right) => {
        const value = (cardId: string) => { const definition = update.definitions[update.view.cards[cardId]?.definitionId ?? '']; return (definition?.honor ?? 0) * 100 + (definition?.combat ?? 0) * 12 + (definition?.purchasePower ?? 0) * 18 - (definition?.cost ?? 0) * 6; };
        return value(right.cardId) - value(left.cardId);
      });
      return buys[0] ?? legal.find(({ type }) => type === 'END_PHASE');
    };
    for (let step = 0; step < 5_000 && update.view.status !== 'finished'; step += 1) {
      if (step === 40) { session = new LocalGameSession(ruleset); update = session.current(); }
      if (update.cpu.status === 'blocked') throw new Error(update.cpu.diagnostic);
      if (update.view.activePlayerId === update.view.viewerId || update.legalCommands.length) {
        const command = chooseHumanCommand();
        if (!command) throw new Error(`Human has no legal command at revision ${update.view.revision}.`);
        update = session.submit(command);
      } else update = session.stepCpu();
      if (update.error) throw new Error(`${update.error.code}: ${update.error.message}`);
    }
    expect(update.view.status).toBe('finished');
    expect(update.scoreboard).toHaveLength(4);
    expect(update.scoreboard!.filter(({ rank }) => rank === 1).length).toBeGreaterThan(0);
    expect(session.exportReplayDiagnostic().json).toContain('base:cpu-balanced');
  }, 30_000);

  it('reports a versioned JSON-only persistence lifecycle without changing game revisions', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    expect(session.current().entrySummary).toEqual({
      schemaVersion: 3,
      contentMode: 'demo',
      advancedRules: { helpers: false },
      contentPackId: 'base:demo',
      canContinue: false,
      gameId: session.current().view.gameId,
      revision: 0,
      round: 1,
      phase: 'action1',
      status: 'playing',
      replayHistoryComplete: true,
    });
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
    expect(restored.entrySummary).toEqual({
      schemaVersion: 3,
      contentMode: 'demo',
      advancedRules: { helpers: false },
      contentPackId: 'base:demo',
      canContinue: true,
      gameId: restored.view.gameId,
      revision: restored.view.revision,
      round: restored.view.round,
      phase: restored.view.phase,
      status: restored.view.status,
      replayHistoryComplete: true,
    });
    expect(JSON.parse(JSON.stringify(restored.entrySummary))).toEqual(restored.entrySummary);

    const restarted = new LocalGameSession(ruleset).restart();
    expect(restarted.view).toMatchObject({ revision: 0, phase: 'action1' });
    expect(restarted.view.gameId).not.toBe(restored.view.gameId);
    expect(restarted.entrySummary.gameId).toBe(restarted.view.gameId);
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

  it('reports and restores the explicitly enabled provisional content fingerprint', () => {
    const ruleset = createRuleset([baseProvisionalFoundationContentPack], [baseRulesModule], { allowProvisionalPlaytest: true });
    const session = new LocalGameSession(ruleset);
    expect(session.current().entrySummary).toMatchObject({
      schemaVersion: 3,
      contentMode: 'provisional-playtest',
      contentPackId: 'base:provisional-foundation',
      canContinue: false,
    });
    session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(new LocalGameSession(ruleset).current().entrySummary).toMatchObject({
      contentMode: 'provisional-playtest',
      contentPackId: 'base:provisional-foundation',
      canContinue: true,
    });
  });

  it('advances the local game sequence when replacing an incompatible content fingerprint', () => {
    const demo = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const saved = new LocalGameSession(demo).restart();
    expect(saved.view.gameId).toBe('local-2');

    const provisional = createRuleset([baseProvisionalFoundationContentPack], [baseRulesModule], { allowProvisionalPlaytest: true });
    const replaced = new LocalGameSession(provisional).restart();
    expect(replaced.view.gameId).toBe('local-4');
    expect(replaced.entrySummary).toMatchObject({ contentMode: 'provisional-playtest', canContinue: false });
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
