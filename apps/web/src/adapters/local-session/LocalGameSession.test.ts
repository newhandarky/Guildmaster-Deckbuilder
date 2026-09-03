import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseDemoContentPack, baseProvisionalFoundationContentPack, baseProvisionalOriginalFullContentPack } from '@guildmaster/content-base';
import { CpuTurnRunner, baseBalancedCpuProfile, cpuProfileForDifficulty } from '@guildmaster/game-ai';
import { baseRulesModule, createGame, createRuleset, dispatch, evaluateCombat, evaluateCombatPartyCapacity, getCpuActionFeatures, getLegalCommands, projectPlayerView, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot, type Ruleset, type RulesModule } from '@guildmaster/game-engine';
import { baseHelpersRulesModule, baseProvisionalHelpersContentPack } from '@guildmaster/content-base-helpers';
import type { EffectDefinition, LifecycleHook } from '@guildmaster/game-protocol';
import type { SessionUpdate } from '../game-session.js';
import { LocalGameSession } from './LocalGameSession.js';
import { createWebRuleset } from '../../app/ruleset.js';

const storageKey = 'guildmaster-mvp-save-v2';
const diagnosticHash = (value: unknown): string => {
  const text = JSON.stringify(value); let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const headlessProgress = (state: ReturnType<typeof createGame>, ruleset: Ruleset) => ({
  round: state.round, phase: state.phase, activePlayerId: state.activePlayerId,
  bossTargets: Object.values(state.enemyTargets).filter(({ kind, status }) => kind === 'boss' && status === 'available').map((target) => {
    const definitionId = state.cards[target.cardInstanceId]?.definitionId;
    return {
      targetId: target.targetId, definitionId,
      players: state.players.map((player) => {
        const combat = evaluateCombat(state, ruleset, player.id, target.targetId);
        const maximumPartySlots = combat.status === 'ready' ? combat.evaluation.maximumPartySlots ?? player.party.length : player.party.length;
        const permittedCombat = combat.status === 'ready' ? evaluateCombatPartyCapacity(state, ruleset, player.id, target.targetId, combat.evaluation.maximumPartySlots, combat.evaluation.equipmentSuppressed) : undefined;
        return { playerId: player.id, permittedCombat, maximumPartySlots, legalAttack: getLegalCommands(state, ruleset, player.id).some((command) => command.type === 'ATTACK_TARGET' && command.targetId === target.targetId) };
      }),
    };
  }),
  players: state.players.map(({ id, history, party }) => ({ id, history, partySize: party.length })),
});
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

function chooseExpeditionHumanCommand(update: SessionUpdate): SessionUpdate['legalCommands'][number] | undefined {
  const legal = update.legalCommands;
  const choice = legal.find(({ type }) => type === 'SELECT_BONDS' || type === 'RESOLVE_EFFECT_CHOICE' || type === 'RESOLVE_EFFECT_ORDER' || type === 'RESPOND_COUNTER_CONSENT');
  if (choice) return choice;
  const availableBoss = Object.values(update.view.enemyTargets).find(({ kind, status }) => kind === 'boss' && status === 'available');
  const bossCombat = availableBoss ? update.definitions[update.view.cards[availableBoss.cardInstanceId]?.definitionId ?? '']?.combat ?? Number.POSITIVE_INFINITY : 0;
  const partyCombat = update.view.self.turnCombatBonus + update.view.self.party.reduce((sum, { adventurerId, equipmentId }) => sum + (update.definitions[update.view.cards[adventurerId]?.definitionId ?? '']?.combat ?? 0) + (equipmentId ? update.definitions[update.view.cards[equipmentId]?.definitionId ?? '']?.combat ?? 0 : 0), 0);
  const needsBossPower = Boolean(availableBoss) && partyCombat < bossCombat;
  const attacks = legal.filter((command): command is Extract<SessionUpdate['legalCommands'][number], { type: 'ATTACK_TARGET' }> => command.type === 'ATTACK_TARGET').sort((left, right) => {
    const targetValue = (targetId: string) => { const target = update.view.enemyTargets[targetId]; const definition = target ? update.definitions[update.view.cards[target.cardInstanceId]?.definitionId ?? ''] : undefined; return (target?.kind === 'boss' ? 10_000 : 0) + (definition?.honor ?? 0) * 100; };
    return targetValue(right.targetId) - targetValue(left.targetId);
  });
  const bossAttack = attacks.find(({ targetId }) => update.view.enemyTargets[targetId]?.kind === 'boss');
  if (bossAttack) return bossAttack;
  if (update.view.phase === 'combat' && needsBossPower && (partyCombat >= bossCombat - 3 || update.view.self.history.defeatedMonsters >= 10)) return legal.find(({ type }) => type === 'END_PHASE');
  if (attacks[0]) return attacks[0];
  for (const type of ['PLAY_ADVENTURER', 'EQUIP_ITEM', 'ATTACH_CARD', 'USE_ITEM'] as const) { const command = legal.find((candidate) => candidate.type === type); if (command) return command; }
  const buys = legal.filter((command): command is Extract<SessionUpdate['legalCommands'][number], { type: 'BUY_CARD' }> => command.type === 'BUY_CARD').sort((left, right) => {
    const value = (cardId: string) => { const definition = update.definitions[update.view.cards[cardId]?.definitionId ?? '']; return (needsBossPower ? (definition?.combat ?? 0) * 10_000 : 0) + (definition?.honor ?? 0) * 100 + (definition?.combat ?? 0) * 12 + (definition?.purchasePower ?? 0) * 18 - (definition?.cost ?? 0) * 6; };
    return value(right.cardId) - value(left.cardId);
  });
  if (needsBossPower) return buys.find(({ cardId }) => (update.definitions[update.view.cards[cardId]?.definitionId ?? '']?.combat ?? 0) > 0)
    ?? legal.find((command) => command.type === 'REFRESH_MARKET' && command.row === 'adventurer')
    ?? legal.find(({ type }) => type === 'END_PHASE');
  return buys[0] ?? legal.find(({ type }) => type === 'END_PHASE');
}

async function driveDeterministicExpedition(
  ruleset: ReturnType<typeof createWebRuleset>,
  maximumSteps: number,
  options: { reloadAtStep?: number; yieldEverySteps: number },
): Promise<{ session: LocalGameSession; update: SessionUpdate; steps: number }> {
  let session = new LocalGameSession(ruleset);
  let update = session.current();
  let steps = 0;
  for (; steps < maximumSteps && update.view.status !== 'finished'; steps += 1) {
    if (steps === options.reloadAtStep) {
      const beforeReload = { gameId: update.view.gameId, revision: update.view.revision };
      session = new LocalGameSession(ruleset);
      update = session.current();
      if (update.view.gameId !== beforeReload.gameId || update.view.revision !== beforeReload.revision || update.persistence.state !== 'restored') {
        throw new Error(`Persistence reload diverged at step ${steps}.`);
      }
    }
    if (update.cpu.status === 'blocked') throw new Error(update.cpu.diagnostic);
    if (update.legalCommands.length) {
      const command = chooseExpeditionHumanCommand(update);
      if (!command) {
        throw new Error(`Human has no legal command at revision ${update.view.revision}: ${JSON.stringify({
          activePlayerId: update.view.activePlayerId,
          viewerId: update.view.viewerId,
          phase: update.view.phase,
          legalCommands: update.legalCommands,
          cpu: update.cpu,
        })}`);
      }
      const beforeSubmit = { revision: update.view.revision, phase: update.view.phase, activePlayerId: update.view.activePlayerId, command };
      update = session.submit(command);
      if (update.error) throw new Error(`${update.error.code}: ${update.error.message}; ${JSON.stringify(beforeSubmit)}`);
    } else if (update.cpu.status === 'ready') {
      const beforeCpu = { revision: update.view.revision, phase: update.view.phase, activePlayerId: update.view.activePlayerId, cpu: update.cpu };
      update = session.stepCpu();
      if (update.error) throw new Error(`${update.error.code}: ${update.error.message}; ${JSON.stringify(beforeCpu)}`);
    }
    else {
      throw new Error(`Neither the human nor CPU scheduler can advance revision ${update.view.revision}: ${JSON.stringify({
        activePlayerId: update.view.activePlayerId,
        viewerId: update.view.viewerId,
        phase: update.view.phase,
        cpu: update.cpu,
      })}`);
    }
    if ((steps + 1) % options.yieldEverySteps === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  return { session, update, steps };
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
    expect(update.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-1' });
    update = session.stepCpu();
    expect(update.view.activePlayerId).toBe('ai-2');
    update = session.stepCpu();
    expect(update.view.activePlayerId).toBe('ai-3');
    update = session.stepCpu();
    expect(update.view).toMatchObject({ status: 'playing', activePlayerId: 'human-1', revision: 4 });
    expect(update.view.bondEvaluations).toHaveLength(5);
    expect(update.view.bondEvaluations.every(({ appliedRules }) => appliedRules.length === 1)).toBe(true);
    const legalBondIds = new Set(update.legalCommands.flatMap((command) => command.type === 'COMPLETE_BONDS' ? command.bondIds : []));
    expect(update.view.bondEvaluations.filter(({ satisfied }) => satisfied).map(({ bondId }) => bondId).sort()).toEqual([...legalBondIds].sort());
    expect(new LocalGameSession(createWebRuleset(undefined, 'provisional-original-full')).current().view.bondEvaluations).toEqual(update.view.bondEvaluations);
    expect(update.cpu.decisions).toHaveLength(3);
    expect(update.cpu.decisions.every(({ command, reasonCode }) => command.type === 'SELECT_BONDS' && reasonCode === 'KEEP_HIGHEST_BOND_VALUE')).toBe(true);
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as { cpuAutomation: { decisions: { contextFingerprint: string; legalCommandsFingerprint: string; actionFeaturesFingerprint: string }[] } };
    expect(persisted.cpuAutomation.decisions).toHaveLength(3);
    expect(persisted.cpuAutomation.decisions.flatMap((decision) => [decision.contextFingerprint, decision.legalCommandsFingerprint, decision.actionFeaturesFingerprint]).every((fingerprint) => /^v1:[0-9a-f]{32}$/.test(fingerprint))).toBe(true);
    expect(JSON.stringify(persisted.cpuAutomation.decisions).length).toBeLessThan(4_000);
  });

  it('starts and restores the custom-adventurer mode as one human plus three CPU players', () => {
    const ruleset = createWebRuleset(undefined, 'custom-adventurers-full');
    const session = new LocalGameSession(ruleset);
    const initial = session.current();
    expect(initial.entrySummary).toMatchObject({ contentMode: 'custom-adventurers-full', advancedRules: { helpers: true } });
    expect(initial.view.opponents).toHaveLength(3);
    expect(Object.values(initial.definitions).filter(({ type }) => type === 'adventurer')).toHaveLength(40);
    expect(initial.view.self.party.every(({ adventurerId }) => initial.view.cards[adventurerId]!.definitionId.startsWith('custom:starter/'))).toBe(true);
    const humanChoice = initial.legalCommands.find(({ type }) => type === 'SELECT_BONDS');
    if (!humanChoice) throw new Error('Expected custom-mode human bond setup command.');
    const saved = session.submit(humanChoice);
    expect(saved.error).toBeUndefined();
    const restored = new LocalGameSession(ruleset).current();
    expect(restored).toMatchObject({
      entrySummary: { contentMode: 'custom-adventurers-full', canContinue: true },
      persistence: { state: 'restored', replayHistoryComplete: true },
      cpu: { status: 'ready', nextActorId: 'ai-1' },
    });
    expect(restored.view.opponents).toHaveLength(3);
  });

  it('rejects the previous full-pack identity in Snapshot and Replay', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const initialConfig = { gameId: 'old-full-identity', seed: 811, players: [{ id: 'human-1', name: '你', kind: 'human' as const }, { id: 'ai-1', name: 'AI 1', kind: 'ai' as const }, { id: 'ai-2', name: 'AI 2', kind: 'ai' as const }, { id: 'ai-3', name: 'AI 3', kind: 'ai' as const }], startingPlayerId: 'human-1' };
    const snapshot = serializeSnapshot(createGame(initialConfig, ruleset));
    for (const packs of [snapshot.contentPacks, snapshot.state.contentPacks]) {
      const pack = packs.find(({ id }) => id === 'base:provisional-original-full')!;
      pack.version = '0.1.0'; pack.hash = 'base-provisional-original-full-v1-neutral-roster-project-copy-policy';
    }
    expect(() => restoreSnapshot(snapshot, ruleset)).toThrow(/registry fingerprint/);
    const registry = replayRegistryFingerprint(ruleset);
    const oldPack = registry.contentPacks.find(({ id }) => id === 'base:provisional-original-full')!;
    oldPack.version = '0.1.0'; oldPack.hash = 'base-provisional-original-full-v1-neutral-roster-project-copy-policy';
    expect(replayGame({ schemaVersion: 1, protocolVersion: 1, registry, initialConfig, commands: [] }, ruleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'REGISTRY_MISMATCH' } });
  });

  it('rejects a full-mode schema 4 save that omits Replay v2 or CPU audit metadata', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const session = new LocalGameSession(ruleset);
    session.restart();
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as Record<string, unknown>;
    delete persisted.replayBundle;
    delete persisted.cpuAutomation;
    localStorage.setItem(storageKey, JSON.stringify(persisted));
    const recovered = new LocalGameSession(ruleset).current();
    expect(recovered).toMatchObject({ view: { revision: 0, status: 'setup' }, persistence: { schemaVersion: 2, state: 'fresh', recoveryReason: 'INVALID_SAVE' } });
    expect(recovered.view.gameId).not.toBe(session.current().view.gameId);
  });

  it.each(['schema-2-envelope', 'legacy-v1-keys'] as const)('rejects a current full-mode Snapshot smuggled through %s', (format) => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const session = new LocalGameSession(ruleset);
    session.restart();
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as { snapshot: unknown };
    localStorage.removeItem(storageKey);
    if (format === 'schema-2-envelope') {
      localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 2, snapshot: persisted.snapshot, events: [] }));
    } else {
      localStorage.setItem('guildmaster-mvp-snapshot-v1', JSON.stringify(persisted.snapshot));
      localStorage.setItem('guildmaster-mvp-events-v1', '[]');
    }
    const recovered = new LocalGameSession(ruleset).current();
    expect(recovered).toMatchObject({ view: { revision: 0, status: 'setup' }, persistence: { schemaVersion: 2, state: 'fresh', recoveryReason: 'INVALID_SAVE' } });
    expect(recovered.view.gameId).not.toBe(session.current().view.gameId);
  });

  it('keeps Replay v2 CPU runner metadata canonical after a rejected human command', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const session = new LocalGameSession(ruleset);
    let update = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) update = session.stepCpu();
    const acceptedGameId = update.view.gameId;
    const acceptedRevision = update.view.revision;
    const rejected = session.submit({ type: 'BUY_CARD', cardId: 'missing-card' });
    expect(rejected.error?.code).toBe('INVALID_COMMAND');
    const restored = new LocalGameSession(ruleset).current();
    expect(restored).toMatchObject({
      view: { gameId: acceptedGameId, revision: acceptedRevision, status: 'playing' },
      persistence: { schemaVersion: 2, state: 'restored', replayHistoryComplete: true },
    });
    expect(restored.persistence.recoveryReason).toBeUndefined();
  });

  it('persists the selected CPU difficulty in local save v5 and Replay v3', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const session = new LocalGameSession(ruleset, 'human-1', { schemaVersion: 1, cpuDifficulty: 'beginner' });
    session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as {
      schemaVersion: number; sessionConfig: unknown;
      replayBundle: { schemaVersion: number; sessionConfig: unknown; automation: { profileId: string } };
    };
    expect(persisted).toMatchObject({
      schemaVersion: 5,
      sessionConfig: { schemaVersion: 1, cpuDifficulty: 'beginner' },
      replayBundle: { schemaVersion: 3, sessionConfig: { schemaVersion: 1, cpuDifficulty: 'beginner' }, automation: { profileId: 'web:cpu-beginner' } },
    });
    expect(new LocalGameSession(ruleset).current()).toMatchObject({ persistence: { state: 'restored' }, cpu: { difficulty: 'beginner', profileId: 'web:cpu-beginner' } });
  });

  it('normalizes a legacy custom-mode save to the formal boss count before writing Replay v3', () => {
    const ruleset = createWebRuleset(undefined, 'custom-adventurers-full');
    const initialConfig = {
      gameId: 'local-1', seed: 20260726,
      players: [
        { id: 'human-1', name: '你', kind: 'human' as const },
        { id: 'ai-1', name: 'CPU 一號', kind: 'ai' as const },
        { id: 'ai-2', name: 'CPU 二號', kind: 'ai' as const },
        { id: 'ai-3', name: 'CPU 三號', kind: 'ai' as const },
      ],
      startingPlayerId: 'human-1',
    };
    const snapshot = serializeSnapshot(createGame(initialConfig, ruleset));
    const automation = { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, runner: { autonomousSteps: 0, turnActions: [], visibleStates: [] }, decisions: [] };
    const replayBundle = { schemaVersion: 2 as const, protocolVersion: 1 as const, registry: replayRegistryFingerprint(ruleset), initialConfig, commands: [], expectedEvents: [], expectedFinalSnapshot: snapshot, automation };
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 4, snapshot, events: [], replayBundle, cpuAutomation: automation }));

    const migrated = new LocalGameSession(ruleset);
    expect(migrated.current()).toMatchObject({ persistence: { state: 'restored' }, entrySummary: { cpuDifficulty: 'challenge', bossDeckSize: 6 } });
    migrated.submit(migrated.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as { schemaVersion: number; sessionConfig: unknown; replayBundle: { schemaVersion: number; sessionConfig: unknown } };
    expect(persisted).toMatchObject({
      schemaVersion: 5,
      sessionConfig: { schemaVersion: 1, cpuDifficulty: 'challenge', bossDeckSize: 6 },
      replayBundle: { schemaVersion: 3, sessionConfig: { schemaVersion: 1, cpuDifficulty: 'challenge', bossDeckSize: 6 } },
    });
    expect(new LocalGameSession(ruleset).current().persistence).toMatchObject({ state: 'restored', replayHistoryComplete: true });
  });

  it('does not reuse a command ID after rejection, suspended root, and reload', () => {
    const humanChoice: EffectDefinition['body'] = { kind: 'choice', choiceId: 'human-phase-choice', decisionKind: 'choose-effect-option', actor: { kind: 'controller' }, options: [{ id: 'continue', effect: modify(0) }] };
    const ruleset = createRuleset([baseProvisionalOriginalFullContentPack], [baseRulesModule, module([hook('phase-end', humanChoice)])], { allowProvisionalPlaytest: true });
    let session = new LocalGameSession(ruleset);
    let update = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) update = session.stepCpu();
    expect(session.submit({ type: 'BUY_CARD', cardId: 'missing-card' }).error?.code).toBe('INVALID_COMMAND');
    update = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(update.view.decisionPrompt?.choiceId).toBe('human-phase-choice');
    session = new LocalGameSession(ruleset);
    const resolution = session.current().legalCommands.find(({ type }) => type === 'RESOLVE_EFFECT_CHOICE');
    if (!resolution) throw new Error('Expected restored human phase choice.');
    expect(session.submit(resolution).error).toBeUndefined();
    const replay = (JSON.parse(localStorage.getItem(storageKey)!) as { replayBundle: { commands: { commandId: string }[] } }).replayBundle;
    expect(new Set(replay.commands.map(({ commandId }) => commandId)).size).toBe(replay.commands.length);
    expect(new LocalGameSession(ruleset).current().persistence).toMatchObject({ state: 'restored', replayHistoryComplete: true });
  });

  it('does not persist an unaudited runner mutation when a CPU decision is blocked', () => {
    const untypedCpuChoice: EffectDefinition['body'] = { kind: 'choice', choiceId: 'untyped-cpu-choice', actor: { kind: 'player-id', playerId: 'ai-1' }, options: [{ id: 'continue', effect: modify(0) }] };
    const ruleset = createRuleset([baseProvisionalOriginalFullContentPack], [baseRulesModule, module([hook('phase-end', untypedCpuChoice)])], { allowProvisionalPlaytest: true });
    const session = new LocalGameSession(ruleset);
    let update = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) update = session.stepCpu();
    update = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(update.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-1' });
    const blocked = session.stepCpu();
    expect(blocked.cpu).toMatchObject({ status: 'blocked' });
    const restored = new LocalGameSession(ruleset).current();
    expect(restored).toMatchObject({ persistence: { state: 'restored', replayHistoryComplete: true }, cpu: { status: 'ready', nextActorId: 'ai-1' } });
    expect(new LocalGameSession(ruleset).stepCpu().cpu).toMatchObject({ status: 'blocked' });
  });

  it('rejects an obsolete deterministic CPU profile with a structured recovery reason', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const session = new LocalGameSession(ruleset);
    let update = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) update = session.stepCpu();
    expect(update.view.status).toBe('playing');
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as {
      cpuAutomation: { profileVersion: string };
      replayBundle: { automation: { profileVersion: string } };
    };
    persisted.cpuAutomation.profileVersion = '0.0.0';
    persisted.replayBundle.automation.profileVersion = '0.0.0';
    localStorage.setItem(storageKey, JSON.stringify(persisted));

    expect(new LocalGameSession(ruleset).current().persistence).toMatchObject({
      state: 'fresh',
      recoveryReason: 'CPU_PROFILE_MISMATCH',
    });
  });

  it.each([
    { label: 'a missing authoritative human', players: [{ id: 'other-human', name: 'Other', kind: 'human' as const }, { id: 'ai-1', name: 'AI 1', kind: 'ai' as const }] },
    { label: 'two human seats', players: [{ id: 'human-1', name: 'Human 1', kind: 'human' as const }, { id: 'human-2', name: 'Human 2', kind: 'human' as const }, { id: 'ai-1', name: 'AI 1', kind: 'ai' as const }, { id: 'ai-2', name: 'AI 2', kind: 'ai' as const }] },
  ])('rejects a canonical full-pack save with $label', ({ players }) => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const initialConfig = { gameId: 'invalid-full-roster', seed: 20260726, players, startingPlayerId: players[0]!.id };
    const snapshot = serializeSnapshot(createGame(initialConfig, ruleset));
    const automation = { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, runner: { autonomousSteps: 0, turnActions: [], visibleStates: [] }, decisions: [] };
    const replayBundle = { schemaVersion: 2 as const, protocolVersion: 1 as const, registry: replayRegistryFingerprint(ruleset), initialConfig, commands: [], expectedEvents: [], expectedFinalSnapshot: snapshot, automation };
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 4, snapshot, events: [], replayBundle, cpuAutomation: automation }));
    const recovered = new LocalGameSession(ruleset).current();
    expect(recovered).toMatchObject({ view: { viewerId: 'human-1', status: 'setup', opponents: expect.arrayContaining([expect.objectContaining({ id: 'ai-1' }), expect.objectContaining({ id: 'ai-2' }), expect.objectContaining({ id: 'ai-3' })]) }, persistence: { state: 'fresh', recoveryReason: 'REPLAY_DIVERGENCE' } });
  });

  it('exposes non-active CPUs as consecutive actors for a human-turn suspension', () => {
    const cpuChoice = (actorId: string, choiceId: string): EffectDefinition['body'] => ({ kind: 'choice', choiceId, decisionKind: 'choose-effect-option', actor: { kind: 'player-id', playerId: actorId }, options: [{ id: 'continue', effect: modify(0) }] });
    const ruleset = createRuleset(
      [baseProvisionalOriginalFullContentPack],
      [baseRulesModule, module([hook('command-before', { kind: 'sequence', effects: [cpuChoice('ai-1', 'ai-1-choice'), cpuChoice('ai-2', 'ai-2-choice')] })])],
      { allowProvisionalPlaytest: true },
    );
    const session = new LocalGameSession(ruleset);
    let update = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) update = session.stepCpu();
    expect(update.view.activePlayerId).toBe('human-1');
    update = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(update.error).toBeUndefined();
    expect(update.view.activePlayerId).toBe('human-1');
    expect(update.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-1' });
    update = session.stepCpu();
    expect(update.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-2' });
  });

  it('changes the scheduler step key for consecutive choices owned by the same CPU', () => {
    const moduleId = 'test:same-cpu-choice';
    const cpuChoice = (choiceId: string): EffectDefinition['body'] => ({ kind: 'choice', choiceId, decisionKind: 'choose-effect-option', actor: { kind: 'player-id', playerId: 'ai-1' }, options: [{ id: 'continue', effect: modify(0) }] });
    const choiceRulesModule: RulesModule = {
      id: moduleId, version: '1', getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled',
      lifecycleHooks: [{ schemaVersion: 1, moduleId, hookId: 'nested', point: 'command-before', kind: 'trigger', priority: 1, effect: { schemaVersion: 1, effectId: `${moduleId}:nested`, body: { kind: 'sequence', effects: [cpuChoice('first-cpu-choice'), cpuChoice('second-cpu-choice')] } } }],
    };
    const ruleset = createRuleset([baseProvisionalOriginalFullContentPack], [baseRulesModule, choiceRulesModule], { allowProvisionalPlaytest: true });
    const session = new LocalGameSession(ruleset);
    let setup = session.submit(session.current().legalCommands.find(({ type }) => type === 'SELECT_BONDS')!);
    for (let cpu = 0; cpu < 3; cpu += 1) setup = session.stepCpu();
    expect(setup.view.status).toBe('playing');
    const first = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(first.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-1' });
    const second = session.stepCpu();
    expect(second.cpu.diagnostic).toBeUndefined();
    expect(second.cpu).toMatchObject({ status: 'ready', nextActorId: 'ai-1' });
    expect(second.view.revision).toBe(first.view.revision);
    expect(second.cpu.stepKey).not.toBe(first.cpu.stepKey);
    const completed = session.stepCpu();
    expect(completed.error).toBeUndefined();
    expect(completed.view).toMatchObject({ revision: first.view.revision + 1, phase: 'combat' });
  });

  it('advances a bounded deterministic expedition across persistence reload without illegal CPU commands', async () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const { update, steps } = await driveDeterministicExpedition(ruleset, 60, { reloadAtStep: 40, yieldEverySteps: 10 });
    expect(steps).toBe(60);
    expect(update.view).toMatchObject({ status: 'playing' });
    expect(update.view.revision).toBeGreaterThan(40);
    expect(update.persistence.replayHistoryComplete).toBe(true);
  }, 20_000);

  it.skipIf(import.meta.env.RUN_FULL_EXPEDITION !== '1')('finishes a deterministic four-player provisional expedition without illegal CPU commands', async () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const { session, update } = await driveDeterministicExpedition(ruleset, 5_000, { reloadAtStep: 40, yieldEverySteps: 25 });
    expect(update.view.status).toBe('finished');
    expect(update.scoreboard).toHaveLength(4);
    expect(update.scoreboard!.filter(({ rank }) => rank === 1).length).toBeGreaterThan(0);
    const replaySource = session.exportReplayDiagnostic().json!;
    const replay = JSON.parse(replaySource) as { schemaVersion: number; automation: { runner: unknown; decisions: { commandId: string; contextFingerprint: string }[] } };
    expect(replay).toMatchObject({ schemaVersion: 3, sessionConfig: { schemaVersion: 1, cpuDifficulty: 'standard' }, automation: { runner: expect.any(Object), decisions: expect.any(Array) } });
    const replayReport = session.runReplayDiagnosticJson(replaySource);
    if (replayReport.status !== 'completed') throw new Error(JSON.stringify(replayReport));
    const tampered = structuredClone(replay);
    tampered.automation.decisions[0]!.commandId = 'tampered-command';
    expect(replayGame(tampered, ruleset)).toMatchObject({ status: 'failed', diagnostic: { reasonCode: 'MALFORMED_BUNDLE' } });
    const forgedAudit = structuredClone(replay);
    forgedAudit.automation.decisions[0]!.contextFingerprint = 'forged-but-non-empty';
    expect(session.runReplayDiagnosticJson(JSON.stringify(forgedAudit))).toMatchObject({ status: 'failed', message: 'Stored CPU decision does not match canonical recomputation.' });
  }, 900_000);

  it.skipIf(import.meta.env.RUN_HEADLESS_REGRESSION !== '1' && import.meta.env.RUN_HEADLESS_SOAK !== '1')('finishes its assigned headless regression seeds within 250 rounds', () => {
    const requestedMode = import.meta.env.HEADLESS_CONTENT_MODE ?? 'provisional-original-full';
    if (requestedMode !== 'provisional-original-full' && requestedMode !== 'custom-adventurers-full') {
      throw new Error(`Unsupported HEADLESS_CONTENT_MODE: ${requestedMode}.`);
    }
    const requestedDifficulty = import.meta.env.HEADLESS_CPU_DIFFICULTY ?? 'challenge';
    if (!['beginner', 'standard', 'challenge'].includes(requestedDifficulty)) throw new Error(`Unsupported HEADLESS_CPU_DIFFICULTY: ${requestedDifficulty}.`);
    const profile = cpuProfileForDifficulty(requestedDifficulty as 'beginner' | 'standard' | 'challenge');
    const requestedBossDeckSize = Number(import.meta.env.HEADLESS_BOSS_DECK_SIZE ?? 6);
    const ruleset = createWebRuleset(undefined, { schemaVersion: 1, contentMode: requestedMode, cpuDifficulty: requestedDifficulty as 'beginner' | 'standard' | 'challenge', advancedRules: { helpers: true }, ...(requestedMode === 'custom-adventurers-full' ? { customRules: { bossDeckSize: requestedBossDeckSize } } : {}) });
    const registryFingerprint = JSON.stringify(replayRegistryFingerprint(ruleset));
    const players = [
      { id: 'p1', name: 'P1', kind: 'ai' as const },
      { id: 'p2', name: 'P2', kind: 'ai' as const },
      { id: 'p3', name: 'P3', kind: 'ai' as const },
      { id: 'p4', name: 'P4', kind: 'ai' as const },
    ];
    const seedStart = Number(import.meta.env.HEADLESS_SEED_START ?? 10_001);
    const seedCount = Number(import.meta.env.HEADLESS_SEED_COUNT ?? 20);
    const traceEnabled = import.meta.env.HEADLESS_TRACE === '1';
    const maximumShardSize = import.meta.env.RUN_HEADLESS_SOAK === '1' ? 100 : 20;
    if (!Number.isSafeInteger(seedStart) || !Number.isSafeInteger(seedCount) || seedCount < 1 || seedCount > maximumShardSize) throw new Error(`Headless seed shard must contain 1–${maximumShardSize} safe integer seeds.`);
    for (const seed of Array.from({ length: seedCount }, (_, index) => seedStart + index)) {
      console.info(`[headless:${requestedMode}] seed ${seed} started`);
      let state = createGame({ gameId: `headless-${requestedMode}-${seed}`, seed, players, startingPlayerId: 'p1' }, ruleset);
      const runner = new CpuTurnRunner(profile);
      const trace: unknown[] = [];
      const progress: unknown[] = [];
      const fail = (message: string): never => { throw new Error(`${message}\nHeadless diagnostics: ${JSON.stringify({ progress, trace })}`); };
      let lastProgressRound = 0;
      let actorKey = '';
      for (let step = 0; step < 20_000 && state.status !== 'finished'; step += 1) {
        const consent = state.effectState.pendingCounterConsent;
        const actorId = consent?.requiredActorIds.find((id) => !consent.acceptedActorIds.includes(id))
          ?? state.effectState.pendingChoice?.actorId
          ?? state.activePlayerId;
        const nextActorKey = `${state.round}:${state.activePlayerId}:${actorId}`;
        if (nextActorKey !== actorKey) { runner.reset(); actorKey = nextActorKey; }
        const view = projectPlayerView(state, ruleset, actorId);
        const legalCommands = getLegalCommands(state, ruleset, actorId);
        const decision = runner.step({
          view,
          legalCommands,
          actionFeatures: getCpuActionFeatures(state, ruleset, actorId),
          definitions: ruleset.registry.definitions,
          bonds: ruleset.registry.bonds,
          rulesetFingerprint: registryFingerprint,
          profile,
        });
        const readyDecision = decision.status === 'ready'
          ? decision
          : fail(`Seed ${seed} blocked at revision ${state.revision}: ${decision.reasonCode} ${decision.diagnostic}`);
        const command = readyDecision.command;
        if (!command) fail(`Seed ${seed} produced no command at revision ${state.revision}.`);
        const stateHashBefore = diagnosticHash(state);
        const result = dispatch(state, ruleset, {
          protocolVersion: 1,
          gameId: state.gameId,
          commandId: `headless-${seed}-${step}`,
          actorId,
          expectedRevision: state.revision,
          command,
        });
        trace.push({
          step, round: state.round, activePlayerId: state.activePlayerId, actorId, phase: state.phase, command,
          pendingChoice: state.effectState.pendingChoice ? { executionId: state.effectState.pendingChoice.executionId, choiceId: state.effectState.pendingChoice.choiceId } : undefined,
          pendingCommandKind: state.effectState.pendingCommand?.kind,
          stateHashBefore, stateHashAfter: result.error ? stateHashBefore : diagnosticHash(result.state),
          reasonCode: readyDecision.reasonCode, score: readyDecision.score, contextHash: diagnosticHash(readyDecision.contextFingerprint),
        });
        if (trace.length > 256) trace.shift();
        if (result.error) fail(`Seed ${seed} rejected ${command.type}: ${result.error.code} ${result.error.message} ${JSON.stringify({ phase: state.phase, actorId, command, helper: state.zones['base:helper-active']?.cardIds.map((id) => state.cards[id]?.definitionId), pendingChoice: state.effectState.pendingChoice?.choiceId, player: state.players.find(({ id }) => id === actorId) })}`);
        state = result.state;
        if (state.round >= lastProgressRound + 10) {
          const summary = headlessProgress(state, ruleset); progress.push(summary); lastProgressRound = state.round;
          if (traceEnabled) console.info(`[headless] seed ${seed} progress ${JSON.stringify(summary)}`);
        }
        if (state.round > 250) fail(`Seed ${seed} exceeded 250 rounds: ${JSON.stringify({ activePlayerId: state.activePlayerId, phase: state.phase, bossTargets: Object.values(state.enemyTargets).filter(({ kind, status }) => kind === 'boss' && status === 'available').map(({ cardInstanceId }) => state.cards[cardInstanceId]?.definitionId), adventurerRow: state.zones['base:adventurer-row']?.cardIds.map((id) => state.cards[id]?.definitionId), players: state.players.map((player) => ({ id: player.id, history: player.history, party: player.party.map(({ adventurerId, equipmentId }) => [state.cards[adventurerId]?.definitionId, equipmentId ? state.cards[equipmentId]?.definitionId : null]), hand: player.hand.map((id) => state.cards[id]?.definitionId), draw: player.drawPile.map((id) => state.cards[id]?.definitionId), discard: player.discardPile.map((id) => state.cards[id]?.definitionId) })) })}`);
      }
      if (state.status !== 'finished') fail(`Seed ${seed} exhausted the 20,000-step headless guard at revision ${state.revision}.`);
      expect(state.status, `seed ${seed}`).toBe('finished');
      console.info(`[headless:${requestedMode}] seed ${seed} completed at round ${state.round}`);
    }
  }, 2_400_000);

  it('reports a versioned JSON-only persistence lifecycle without changing game revisions', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    expect(session.current().committedEvents).toEqual([]);
    expect(session.current().entrySummary).toEqual({
      schemaVersion: 3,
      contentMode: 'demo',
      advancedRules: { helpers: false },
      cpuDifficulty: 'standard',
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
      schemaVersion: 2,
      state: 'fresh',
      revision: 0,
      replayHistoryComplete: true,
    });

    const saved = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(saved.committedEvents.length).toBeGreaterThan(0);
    expect(saved.committedEvents.every((event) => saved.events.some(({ eventId }) => eventId === event.eventId))).toBe(true);
    expect(saved.persistence).toEqual({
      schemaVersion: 2,
      state: 'saved',
      revision: saved.view.revision,
      replayHistoryComplete: true,
    });
    expect(JSON.parse(JSON.stringify(saved.persistence))).toEqual(saved.persistence);

    const restored = new LocalGameSession(ruleset).current();
    expect(restored.committedEvents).toEqual([]);
    expect(restored.persistence).toEqual({
      schemaVersion: 2,
      state: 'restored',
      revision: saved.view.revision,
      replayHistoryComplete: true,
    });
    expect(restored.view).toMatchObject({ gameId: saved.view.gameId, revision: saved.view.revision });
    expect(restored.entrySummary).toEqual({
      schemaVersion: 3,
      contentMode: 'demo',
      advancedRules: { helpers: false },
      cpuDifficulty: 'standard',
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
      schemaVersion: 2,
      state: 'restored',
      revision: 0,
      replayHistoryComplete: false,
    });
    expect(restored.replayHistoryComplete).toBe(false);
  });

  it('fails closed and clears a save whose outer Snapshot diverges from its command Replay', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    session.submit({ type: 'END_PHASE', phase: 'action1' });
    const stored = JSON.parse(localStorage.getItem(storageKey)!) as { snapshot: { state: { rngState: number } } };
    stored.snapshot.state.rngState += 1;
    localStorage.setItem(storageKey, JSON.stringify(stored));
    const recovered = new LocalGameSession(ruleset).current();
    expect(recovered).toMatchObject({ view: { revision: 0, phase: 'action1' }, persistence: { schemaVersion: 2, state: 'fresh', recoveryReason: 'REPLAY_DIVERGENCE' } });
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('keeps accepted progress playable and separates storage failure from engine errors', () => {
    vi.stubGlobal('localStorage', memoryStorage({ failWrites: true }));
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const update = new LocalGameSession(ruleset).submit({ type: 'END_PHASE', phase: 'action1' });
    expect(update.error).toBeUndefined();
    expect(update.view).toMatchObject({ revision: 1, phase: 'combat' });
    expect(update.persistence).toEqual({
      schemaVersion: 2,
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
      schemaVersion: 2,
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

  it('clears helper 0.1 progress with a structured one-time recovery reason', () => {
    const oldPack = {
      ...baseProvisionalHelpersContentPack,
      manifest: { ...baseProvisionalHelpersContentPack.manifest, version: '0.1.0', hash: 'base-provisional-helpers-v1-helper-08-capacity' },
    };
    const oldModule = { ...baseHelpersRulesModule, version: '1.0.0' };
    const oldRuleset = createRuleset(
      [baseProvisionalFoundationContentPack, oldPack],
      [baseRulesModule, oldModule],
      { allowProvisionalPlaytest: true },
    );
    const oldState = createGame({ gameId: 'local-7', seed: 19, players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: 'AI', kind: 'ai' }], startingPlayerId: 'human-1' }, oldRuleset);
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(oldState), events: [] }));
    const currentRuleset = createRuleset(
      [baseProvisionalFoundationContentPack, baseProvisionalHelpersContentPack],
      [baseRulesModule, baseHelpersRulesModule],
      { allowProvisionalPlaytest: true },
    );
    const session = new LocalGameSession(currentRuleset);
    const recovered = session.current();
    expect(recovered.view).toMatchObject({ gameId: 'local-8', revision: 0 });
    expect(recovered.persistence).toEqual({
      schemaVersion: 2,
      state: 'fresh',
      revision: 0,
      replayHistoryComplete: true,
      recovery: { reasonCode: 'helper-rules-upgraded', previousPackVersion: '0.1.0', previousModuleVersion: '1.0.0' },
    });
    expect(recovered.entrySummary).toMatchObject({ advancedRules: { helpers: true }, canContinue: false });
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(session.current().persistence.recovery).toBeUndefined();
  });

  it('clears the immediately previous full-mode registry with a structured one-time recovery reason', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const current = new LocalGameSession(ruleset);
    current.restart();
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as {
      snapshot: {
        contentPacks: Array<{ id: string; version: string; hash: string }>;
        state: {
          contentPacks: Array<{ id: string; version: string; hash: string }>;
          rulesModules: Array<{ id: string; version: string }>;
        };
      };
    };
    for (const packs of [persisted.snapshot.contentPacks, persisted.snapshot.state.contentPacks]) {
      const pack = packs.find(({ id }) => id === 'base:provisional-original-full')!;
      pack.version = '0.19.0'; pack.hash = 'base-provisional-original-full-v20-card-effect-completion';
    }
    persisted.snapshot.state.rulesModules.find(({ id }) => id === 'base:provisional-original-full-rules')!.version = '2.9.0';
    localStorage.setItem(storageKey, JSON.stringify(persisted));

    const recoveredSession = new LocalGameSession(ruleset);
    const recovered = recoveredSession.current();
    expect(recovered.view).toMatchObject({ revision: 0, status: 'setup' });
    expect(recovered.persistence).toMatchObject({
      state: 'fresh',
      recovery: { reasonCode: 'card-rules-upgraded', previousPackVersion: '0.19.0', previousModuleVersion: '2.9.0' },
    });
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(recoveredSession.current().persistence.recovery).toBeUndefined();
  });

  it('clears full-mode rules 2.10 progress after the bond completion timing upgrade', () => {
    const ruleset = createWebRuleset(undefined, 'provisional-original-full');
    const current = new LocalGameSession(ruleset);
    current.restart();
    const persisted = JSON.parse(localStorage.getItem(storageKey)!) as {
      snapshot: { state: { rulesModules: Array<{ id: string; version: string }> } };
    };
    persisted.snapshot.state.rulesModules.find(({ id }) => id === 'base:provisional-original-full-rules')!.version = '2.10.0';
    localStorage.setItem(storageKey, JSON.stringify(persisted));

    const recoveredSession = new LocalGameSession(ruleset);
    const recovered = recoveredSession.current();
    expect(recovered.view).toMatchObject({ revision: 0, status: 'setup' });
    expect(recovered.persistence).toMatchObject({
      state: 'fresh',
      recovery: { reasonCode: 'card-rules-upgraded', previousPackVersion: '0.20.0', previousModuleVersion: '2.10.0' },
    });
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(recoveredSession.current().persistence.recovery).toBeUndefined();
  });

  it('returns action previews tied to the current game, actor, revision, and legal commands', () => {
    const ruleset = createRuleset([baseDemoContentPack], [baseRulesModule]);
    const session = new LocalGameSession(ruleset);
    const combat = session.submit({ type: 'END_PHASE', phase: 'action1' });
    expect(combat.actionPreviews).toMatchObject({ schemaVersion: 2, gameId: combat.view.gameId, revision: combat.view.revision, actorId: 'human-1' });
    expect(combat.actionPreviews.items.length).toBeGreaterThan(0);
    expect(combat.actionPreviews.items.every(({ command }) => combat.legalCommands.some((legal) => JSON.stringify(legal) === JSON.stringify(command)))).toBe(true);
  });

  it('records one committed audit after choice suspension and never duplicates suspended events', () => {
    const choice: EffectDefinition['body'] = {
      kind: 'choice',
      decisionKind: 'choose-effect-option',
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
