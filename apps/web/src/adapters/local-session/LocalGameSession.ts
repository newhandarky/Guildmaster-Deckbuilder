import { CpuTurnRunner, baseBalancedCpuProfile, simpleAiStrategy, asEnvelope } from '@guildmaster/game-ai';
import { createGame, dispatch, getActionPreviewSet, getCpuActionFeatures, getLegalCommands, getScoreboard, projectPlayerView, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot, type Ruleset } from '@guildmaster/game-engine';
import { stableJsonFingerprint, type CommandEnvelope, type DomainEvent, type EngineError, type GameCommand, type GameState, type ReplayAutomationDecision, type ReplayBundle, type ReplayInitialConfig } from '@guildmaster/game-protocol';
import type { ReplayDiagnosticExport, ReplayRunnerReport, SessionPersistenceStatus, SessionUpdate } from '../game-session.js';
import { clearLocalGame, loadLocalGame, saveLocalGame } from './local-storage.js';
import { auditCpuReplay } from './cpu-replay-audit.js';
import { webContentModeFromPackIds } from '../../app/content-mode.js';

const localGameIdPattern = /^local-(\d+)$/;

export class LocalGameSession {
  private state: GameState;
  private readonly processed = new Map<string, SessionUpdate>();
  private events: DomainEvent[];
  private auditEvents: DomainEvent[] = [];
  private commands: CommandEnvelope[] = [];
  private initialConfig!: ReplayInitialConfig;
  private replayHistoryComplete = true;
  private persistenceState: SessionPersistenceStatus['state'] = 'fresh';
  private recovery: SessionPersistenceStatus['recovery'];
  private commandSequence = 0;
  private gameSequence = 0;
  private readonly cpuRunner = new CpuTurnRunner(baseBalancedCpuProfile);
  private cpuDiagnostic: string | undefined;
  private cpuDecisions: ReplayAutomationDecision[] = [];
  private persistenceCompletion: Promise<void> = Promise.resolve();
  private persistenceGeneration = 0;
  private recoveryReason: SessionPersistenceStatus['recoveryReason'];

  constructor(private readonly ruleset: Ruleset, private readonly humanId = 'human-1') {
    const loaded = loadLocalGame();
    if (loaded.status === 'loaded') {
      const rulesUpgrade = this.rulesUpgradeRecovery(loaded.game.snapshot);
      try {
        const saved = loaded.game;
        if (typeof saved.snapshot?.state?.gameId === 'string') this.restoreGameSequence(saved.snapshot.state.gameId);
        if (saved.replayBundle && saved.replayHistoryComplete) {
          const replayed = replayGame(saved.replayBundle, this.ruleset);
          if (replayed.status !== 'completed') throw new Error(`Saved replay failed validation: ${replayed.diagnostic.message}`);
          if (this.isFourPlayerMode()) {
            const cpuAudit = auditCpuReplay(saved.replayBundle, this.ruleset);
            if (cpuAudit.status !== 'verified') throw new Error(`Saved CPU Replay is not auditable: ${cpuAudit.diagnostic}`);
          }
          if (stableJsonFingerprint(replayed.finalSnapshot) !== stableJsonFingerprint(saved.snapshot)) throw new Error('Saved replay final Snapshot does not match the outer save Snapshot.');
          if (stableJsonFingerprint(replayed.events.slice(-60)) !== stableJsonFingerprint(saved.events)) throw new Error('Saved replay events do not match the outer save event tail.');
          if (saved.replayBundle.schemaVersion === 2 && (!saved.cpuAutomation || stableJsonFingerprint(saved.replayBundle.automation) !== stableJsonFingerprint(saved.cpuAutomation))) throw new Error('Saved CPU automation does not match Replay v2 metadata.');
        }
        const restoredState = restoreSnapshot(saved.snapshot, this.ruleset);
        this.assertPlayerAuthority(restoredState, saved.replayBundle?.initialConfig);
        this.state = restoredState;
        this.events = saved.events;
        this.replayHistoryComplete = saved.replayHistoryComplete;
        this.persistenceState = 'restored';
        if (saved.replayBundle) {
          this.initialConfig = structuredClone(saved.replayBundle.initialConfig);
          this.commands = structuredClone([...saved.replayBundle.commands]);
          this.auditEvents = structuredClone([...(saved.replayBundle.expectedEvents ?? [])]);
          this.commandSequence = this.commands.reduce((maximum, { commandId }) => {
            const suffix = /-(\d+)$/.exec(commandId)?.[1];
            const sequence = suffix === undefined ? 0 : Number(suffix);
            return Number.isSafeInteger(sequence) ? Math.max(maximum, sequence) : maximum;
          }, this.commands.length);
        }
        if (saved.cpuAutomation) {
          if (saved.cpuAutomation.profileId !== baseBalancedCpuProfile.profileId || saved.cpuAutomation.profileVersion !== baseBalancedCpuProfile.version) throw new Error('Saved CPU profile is incompatible.');
          this.cpuRunner.restore(saved.cpuAutomation.runner);
          this.cpuDecisions = structuredClone(saved.cpuAutomation.decisions);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!rulesUpgrade) this.recoveryReason = message.includes('profile') ? 'CPU_PROFILE_MISMATCH' : message.includes('registry') || message.includes('Rules Module') ? 'REGISTRY_MISMATCH' : 'REPLAY_DIVERGENCE';
        const cleared = clearLocalGame();
        this.state = this.createFreshGame();
        this.events = [];
        this.persistenceState = cleared.durable ? 'fresh' : 'saving';
        if (!cleared.durable) this.trackPersistence(cleared.completion, 'fresh');
        if (rulesUpgrade) this.recovery = rulesUpgrade;
      }
    } else {
      this.state = this.createFreshGame();
      this.events = [];
      if (loaded.status === 'invalid-cleared') this.recoveryReason = 'INVALID_SAVE';
      this.persistenceState = loaded.status === 'unavailable' ? 'memory-only' : 'fresh';
    }
  }

  private createFreshGame(): GameState {
    this.gameSequence += 1;
    const seed = this.ruleset.registry.packs.some(({ id }) => id === 'base:e2e-helper-batch-a') ? 1 : 20260726;
    const fourPlayer = this.isFourPlayerMode();
    this.initialConfig = { gameId: `local-${this.gameSequence}`, seed, players: fourPlayer
      ? [{ id: this.humanId, name: '你', kind: 'human' }, { id: 'ai-1', name: 'CPU 一號', kind: 'ai' }, { id: 'ai-2', name: 'CPU 二號', kind: 'ai' }, { id: 'ai-3', name: 'CPU 三號', kind: 'ai' }]
      : [{ id: this.humanId, name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }], startingPlayerId: this.humanId };
    this.commands = [];
    this.auditEvents = [];
    this.replayHistoryComplete = true;
    this.cpuRunner.reset(); this.cpuDecisions = []; this.cpuDiagnostic = undefined;
    return createGame(this.initialConfig, this.ruleset);
  }

  private isFourPlayerMode(): boolean {
    const mode = webContentModeFromPackIds(this.ruleset.registry.packs.map(({ id }) => id));
    return mode === 'provisional-original-full' || mode === 'custom-adventurers-full';
  }

  private assertPlayerAuthority(state: GameState, initialConfig?: ReplayInitialConfig): void {
    if (!this.isFourPlayerMode()) return;
    const ids = state.players.map(({ id }) => id);
    const human = state.players.filter(({ kind }) => kind === 'human');
    const ai = state.players.filter(({ kind }) => kind === 'ai');
    if (state.players.length !== 4 || new Set(ids).size !== 4 || human.length !== 1 || human[0]?.id !== this.humanId || ai.length !== 3 || state.startingPlayerId !== this.humanId) throw new Error('Full offline mode requires exactly one authoritative human and three AI players, with the human as starting player.');
    if (initialConfig) {
      const configured = initialConfig.players.map(({ id, kind }) => `${id}:${kind}`).sort();
      const restored = state.players.map(({ id, kind }) => `${id}:${kind}`).sort();
      if (initialConfig.startingPlayerId !== this.humanId || stableJsonFingerprint(configured) !== stableJsonFingerprint(restored)) throw new Error('Full offline Replay player authority does not match the restored Snapshot.');
    }
  }

  private restoreGameSequence(gameId: string): void {
    const match = localGameIdPattern.exec(gameId);
    if (!match) return;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence)) this.gameSequence = Math.max(this.gameSequence, sequence);
  }

  private rulesUpgradeRecovery(snapshot: { state?: unknown }): SessionPersistenceStatus['recovery'] {
    const value = snapshot.state;
    if (!value || typeof value !== 'object') return undefined;
    const state = value as Partial<GameState>;
    const oldPack = state.contentPacks?.some(({ id, version }) => id === 'base:provisional-helpers' && version === '0.1.0') ?? false;
    const oldModule = state.rulesModules?.some(({ id, version }) => id === 'base:helpers' && version === '1.0.0') ?? false;
    const currentPack = this.ruleset.registry.packs.some(({ id, version }) => id === 'base:provisional-helpers' && version !== '0.1.0');
    const currentModule = this.ruleset.modules.some(({ id, version }) => id === 'base:helpers' && version !== '1.0.0');
    const oldFull = state.contentPacks?.some(({ id }) => id === 'base:provisional-original-full') && !(state.contentPacks?.some(({ id }) => id === 'base:provisional-original-full-helpers'));
    const currentFull = this.ruleset.registry.packs.some(({ id }) => id === 'base:provisional-original-full-helpers');
    if (oldPack && oldModule && currentPack && currentModule || Boolean(oldFull && currentFull)) return { reasonCode: 'helper-rules-upgraded', previousPackVersion: '0.1.0', previousModuleVersion: '1.0.0' };
    const previousFullPack = state.contentPacks?.find(({ id, version }) => id === 'base:provisional-original-full' && ['0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.8.0', '0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.13.0', '0.14.0', '0.15.0', '0.16.0', '0.17.0'].includes(version));
    const previousFullModule = state.rulesModules?.find(({ id, version }) => id === 'base:provisional-original-full-rules' && ['1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0'].includes(version));
    const currentFullPack = this.ruleset.registry.packs.some(({ id, version }) => id === 'base:provisional-original-full' && version === '0.18.0');
    const currentFullModule = this.ruleset.modules.some(({ id, version }) => id === 'base:provisional-original-full-rules' && version === '2.8.0');
    return previousFullPack && previousFullModule && currentFullPack && currentFullModule
      ? { reasonCode: 'card-rules-upgraded', previousPackVersion: previousFullPack.version, previousModuleVersion: previousFullModule.version }
      : undefined;
  }

  current(): SessionUpdate {
    const update = this.makeUpdate([]);
    this.recovery = undefined;
    return update;
  }

  async whenPersistenceSettled(): Promise<SessionUpdate> { await this.persistenceCompletion; return this.current(); }

  restart(): SessionUpdate {
    this.recoveryReason = undefined;
    this.recovery = undefined;
    this.state = this.createFreshGame();
    this.events = [];
    this.processed.clear();
    this.commandSequence = 0;
    return this.persistAndReturn([]);
  }

  submit(command: GameCommand): SessionUpdate {
    const envelope: CommandEnvelope = { protocolVersion: 1, gameId: this.state.gameId, commandId: this.nextCommandId(this.humanId), actorId: this.humanId, expectedRevision: this.state.revision, command };
    return this.submitEnvelope(envelope, { accepted: () => this.cpuRunner.reset() });
  }

  private nextCommandId(actorId: string): string {
    this.commandSequence += 1;
    return `${actorId}-${this.state.revision + 1}-${this.commandSequence}`;
  }

  private submitEnvelope(envelope: CommandEnvelope, automation?: { accepted?: () => void; rejected?: () => void }): SessionUpdate {
    const duplicate = this.processed.get(envelope.commandId);
    if (duplicate) return duplicate;
    const priorCursor = this.state.eventLogCursor;
    const pendingRootCommandId = this.pendingRootCommandId(this.state);
    const result = dispatch(this.state, this.ruleset, envelope);
    this.state = result.state;
    if (result.error) {
      automation?.rejected?.();
      this.rollbackCommandHistoryIfNeeded(pendingRootCommandId);
      return this.persistAndReturn([], result.error);
    }
    automation?.accepted?.();
    const committedEvents = this.committedEvents(priorCursor, result.events);
    this.events.push(...committedEvents);
    this.recordAccepted(envelope, committedEvents);
    const aiError = this.isFourPlayerMode() ? undefined : this.runAi();
    const update = this.persistAndReturn(committedEvents, aiError);
    this.processed.set(envelope.commandId, update);
    return update;
  }

  stepCpu(): SessionUpdate {
    const actor = this.nextAiActor();
    if (!actor) { this.cpuDiagnostic = undefined; return this.persistAndReturn([]); }
    const view = projectPlayerView(this.state, this.ruleset, actor.id);
    const legalCommands = getLegalCommands(this.state, this.ruleset, actor.id);
    const actionFeatures = getCpuActionFeatures(this.state, this.ruleset, actor.id);
    const runnerBeforeDecision = this.cpuRunner.snapshot();
    const decision = this.cpuRunner.step({
      view, legalCommands, actionFeatures,
      definitions: this.ruleset.registry.definitions, bonds: this.ruleset.registry.bonds,
      rulesetFingerprint: JSON.stringify(replayRegistryFingerprint(this.ruleset)), profile: baseBalancedCpuProfile,
    });
    if (decision.status === 'blocked') {
      this.cpuRunner.restore(runnerBeforeDecision);
      this.cpuDiagnostic = `${decision.reasonCode}: ${decision.diagnostic}`;
      return this.persistAndReturn([]);
    }
    this.cpuDiagnostic = undefined;
    const commandId = this.nextCommandId(actor.id);
    const recordedDecision = { commandId, revision: view.revision, actorId: actor.id, command: structuredClone(decision.command), reasonCode: decision.reasonCode, score: decision.score, scoreBreakdown: structuredClone(decision.scoreBreakdown), contextFingerprint: decision.contextFingerprint, legalCommandsFingerprint: stableJsonFingerprint(legalCommands), actionFeaturesFingerprint: stableJsonFingerprint(actionFeatures) };
    return this.submitEnvelope(asEnvelope(view, actor.id, decision.command, commandId), {
      accepted: () => this.cpuDecisions.push(recordedDecision),
      rejected: () => this.cpuRunner.restore(runnerBeforeDecision),
    });
  }

  private runAi(): EngineError | undefined {
    for (let turns = 0; turns < 80 && this.state.status !== 'finished' && this.state.status !== 'pendingOfficialRuling'; turns += 1) {
      const actor = this.nextAiActor();
      if (!actor) return undefined;
      const view = projectPlayerView(this.state, this.ruleset, actor.id);
      const command = simpleAiStrategy.chooseCommand(view, getLegalCommands(this.state, this.ruleset, actor.id));
      if (!command) return undefined;
      const envelope = asEnvelope(view, actor.id, command, this.nextCommandId(actor.id));
      const priorCursor = this.state.eventLogCursor;
      const pendingRootCommandId = this.pendingRootCommandId(this.state);
      const result = dispatch(this.state, this.ruleset, envelope);
      this.state = result.state;
      if (result.error) {
        this.rollbackCommandHistoryIfNeeded(pendingRootCommandId);
        return result.error;
      }
      const committedEvents = this.committedEvents(priorCursor, result.events);
      this.events.push(...committedEvents);
      this.recordAccepted(envelope, committedEvents);
    }
    return undefined;
  }

  private nextAiActor(): GameState['players'][number] | undefined {
    const consent = this.state.effectState.pendingCounterConsent;
    if (consent) {
      return this.state.players.find((player) =>
        player.kind === 'ai'
        && consent.requiredActorIds.includes(player.id)
        && !consent.acceptedActorIds.includes(player.id)
      );
    }
    const choiceActorId = this.state.effectState.pendingChoice?.actorId;
    if (choiceActorId) return this.state.players.find((player) => player.id === choiceActorId && player.kind === 'ai');
    return this.state.players.find((player) => player.id === this.state.activePlayerId && player.kind === 'ai');
  }

  private committedEvents(priorCursor: number, transactionEvents: readonly DomainEvent[]): DomainEvent[] {
    const committedCount = this.state.eventLogCursor - priorCursor;
    return committedCount > 0 ? structuredClone(transactionEvents.slice(-committedCount)) : [];
  }

  private pendingRootCommandId(state: GameState): string | undefined {
    return state.effectState.pendingPostCommand?.envelope.commandId
      ?? state.effectState.pendingCommand?.envelope.commandId;
  }

  private rollbackCommandHistoryIfNeeded(pendingRootCommandId: string | undefined): void {
    if (!pendingRootCommandId || this.pendingRootCommandId(this.state)) return;
    const checkpoint = this.commands.findIndex(({ commandId }) => commandId === pendingRootCommandId);
    if (checkpoint >= 0) this.commands.splice(checkpoint);
  }

  private persistAndReturn(newEvents: DomainEvent[], error?: EngineError): SessionUpdate {
    try {
      const receipt = saveLocalGame(serializeSnapshot(this.state), this.events, this.replayHistoryComplete ? this.replayBundle() : undefined, { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, runner: this.cpuRunner.snapshot(), decisions: structuredClone(this.cpuDecisions) });
      this.persistenceState = receipt.durable ? 'saved' : 'saving';
      if (!receipt.durable) this.trackPersistence(receipt.completion, 'saved');
    } catch {
      this.persistenceState = 'memory-only';
    }
    return this.makeUpdate(newEvents, error);
  }

  private trackPersistence(completion: Promise<void>, successState: SessionPersistenceStatus['state']): void {
    const generation = ++this.persistenceGeneration;
    this.persistenceCompletion = completion.then(
      () => { if (generation === this.persistenceGeneration) this.persistenceState = successState; },
      () => { if (generation === this.persistenceGeneration) this.persistenceState = 'memory-only'; },
    );
  }

  private makeUpdate(_newEvents: DomainEvent[], error?: EngineError): SessionUpdate {
    const legalCommands = getLegalCommands(this.state, this.ruleset, this.humanId);
    const nextAiActor = this.nextAiActor();
    const pendingChoice = this.state.effectState.pendingChoice;
    const pendingConsent = this.state.effectState.pendingCounterConsent;
    const cpuStepKey = JSON.stringify({
      gameId: this.state.gameId,
      revision: this.state.revision,
      eventLogCursor: this.state.eventLogCursor,
      actorId: nextAiActor?.id ?? null,
      choice: pendingChoice ? [pendingChoice.executionId, pendingChoice.choiceId] : null,
      consent: pendingConsent ? [pendingConsent.executionId, pendingConsent.requestId, pendingConsent.acceptedActorIds] : null,
      commandSequence: this.commandSequence,
    });
    const basePack = this.ruleset.registry.packs.find(({ role }) => role === 'base');
    if (!basePack) throw new Error('LocalGameSession requires one base Content Pack.');
    const update: SessionUpdate = {
      view: projectPlayerView(this.state, this.ruleset, this.humanId),
      definitions: this.ruleset.registry.definitions,
      bondDefinitions: this.ruleset.registry.bonds,
      events: this.events.slice(-60),
      legalCommands,
      actionPreviews: getActionPreviewSet(this.state, this.ruleset, this.humanId),
      entrySummary: {
        schemaVersion: 3,
        contentMode: webContentModeFromPackIds(this.ruleset.registry.packs.map(({ id }) => id)),
        advancedRules: { helpers: this.ruleset.modules.some(({ id }) => id === 'base:helpers') },
        contentPackId: basePack.id,
        canContinue: this.persistenceState === 'restored',
        gameId: this.state.gameId,
        revision: this.state.revision,
        round: this.state.round,
        phase: this.state.phase,
        status: this.state.status,
        replayHistoryComplete: this.replayHistoryComplete,
      },
      persistence: {
        schemaVersion: 2,
        state: this.persistenceState,
        revision: this.state.revision,
        replayHistoryComplete: this.replayHistoryComplete,
        ...(this.recoveryReason ? { recoveryReason: this.recoveryReason } : {}),
        ...(this.recovery ? { recovery: structuredClone(this.recovery) } : {}),
      },
      replayHistoryComplete: this.replayHistoryComplete,
      cpu: { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, status: this.cpuDiagnostic ? 'blocked' : nextAiActor ? 'ready' : 'idle', ...(nextAiActor ? { nextActorId: nextAiActor.id } : {}), stepKey: cpuStepKey, ...(this.cpuDiagnostic ? { diagnostic: this.cpuDiagnostic } : {}), decisions: this.cpuDecisions.slice(-100) },
      error,
    };
    return { ...update, scoreboard: this.state.status === 'finished' ? getScoreboard(this.state, this.ruleset) : undefined };
  }

  private recordAccepted(envelope: CommandEnvelope, events: readonly DomainEvent[]): void {
    this.commands.push(structuredClone(envelope));
    this.auditEvents.push(...structuredClone(events));
  }

  private replayBundle(): ReplayBundle {
    const common = { protocolVersion: 1 as const, registry: replayRegistryFingerprint(this.ruleset), initialConfig: structuredClone(this.initialConfig), commands: structuredClone(this.commands), expectedEvents: structuredClone(this.auditEvents), expectedFinalSnapshot: serializeSnapshot(this.state) };
    if (!this.isFourPlayerMode()) return { ...common, schemaVersion: 1, automation: { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, decisions: this.cpuDecisions.map(({ revision, actorId, command, reasonCode, score }) => ({ revision, actorId, command: structuredClone(command), reasonCode, score })) } };
    return { ...common, schemaVersion: 2, automation: { profileId: baseBalancedCpuProfile.profileId, profileVersion: baseBalancedCpuProfile.version, runner: this.cpuRunner.snapshot(), decisions: structuredClone(this.cpuDecisions) } };
  }

  exportReplayDiagnostic(): ReplayDiagnosticExport {
    if (!this.replayHistoryComplete) return { error: '此舊存檔只保存 Snapshot，沒有完整 Command Replay history。' };
    if (this.state.status !== 'finished') return { error: '為保護未公開牌序、手牌與隨機種子，完整 Replay 只能在對局結束後匯出。' };
    try { return { json: JSON.stringify(this.replayBundle(), null, 2) }; }
    catch { return { error: 'Replay diagnostic 匯出失敗；目前對局與本機存檔未受影響。' }; }
  }

  /** Runs an imported audit bundle without mutating the live game, save, or command log. */
  runReplayDiagnosticJson(source: string): ReplayRunnerReport {
    let bundle: unknown;
    try { bundle = JSON.parse(source); }
    catch { return { status: 'failed', message: 'Replay JSON 無法解析。' }; }
    const result = replayGame(bundle, this.ruleset);
    if (result.status === 'completed' && this.isFourPlayerMode()) {
      const cpuAudit = auditCpuReplay(bundle, this.ruleset);
      if (cpuAudit.status !== 'verified') return { status: 'failed', message: cpuAudit.diagnostic };
    }
    if (result.status === 'completed') return { status: 'completed', message: 'Replay 完成，沒有偵測到 divergence。', commandCount: Array.isArray((bundle as { commands?: unknown }).commands) ? (bundle as { commands: unknown[] }).commands.length : 0, eventCount: result.events.length, revision: result.finalSnapshot.state.revision };
    const diagnostic = result.diagnostic;
    return { status: 'failed', message: diagnostic.message, reasonCode: diagnostic.reasonCode, commandIndex: diagnostic.commandIndex, commandId: diagnostic.commandId, expectedRevision: diagnostic.expectedRevision, actualRevision: diagnostic.actualRevision, engineErrorCode: diagnostic.engineErrorCode, ...(diagnostic.divergence ? { divergence: structuredClone(diagnostic.divergence) } : {}) };
  }
}
