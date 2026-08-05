import { simpleAiStrategy, asEnvelope } from '@guildmaster/game-ai';
import { createGame, dispatch, getActionPreviewSet, getLegalCommands, getScoreboard, projectPlayerView, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot, type Ruleset } from '@guildmaster/game-engine';
import type { CommandEnvelope, DomainEvent, EngineError, GameCommand, GameState, ReplayBundle, ReplayInitialConfig } from '@guildmaster/game-protocol';
import type { ReplayDiagnosticExport, ReplayRunnerReport, SessionPersistenceStatus, SessionUpdate } from '../game-session.js';
import { clearLocalGame, loadLocalGame, saveLocalGame } from './local-storage.js';

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
  private commandSequence = 0;
  private gameSequence = 0;

  constructor(private readonly ruleset: Ruleset, private readonly humanId = 'human-1') {
    const loaded = loadLocalGame();
    if (loaded.status === 'loaded') {
      try {
        const saved = loaded.game;
        this.state = restoreSnapshot(saved.snapshot, this.ruleset);
        this.restoreGameSequence(this.state.gameId);
        this.events = saved.events;
        this.replayHistoryComplete = saved.replayHistoryComplete;
        this.persistenceState = 'restored';
        if (saved.replayBundle) {
          this.initialConfig = structuredClone(saved.replayBundle.initialConfig);
          this.commands = structuredClone([...saved.replayBundle.commands]);
          this.auditEvents = structuredClone([...(saved.replayBundle.expectedEvents ?? [])]);
          this.commandSequence = this.commands.length;
        }
      } catch {
        const cleared = clearLocalGame();
        this.state = this.createFreshGame();
        this.events = [];
        this.persistenceState = cleared ? 'fresh' : 'memory-only';
      }
    } else {
      this.state = this.createFreshGame();
      this.events = [];
      this.persistenceState = loaded.status === 'unavailable' ? 'memory-only' : 'fresh';
    }
  }

  private createFreshGame(): GameState {
    this.gameSequence += 1;
    this.initialConfig = { gameId: `local-${this.gameSequence}`, seed: 20260726, players: [{ id: this.humanId, name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }], startingPlayerId: this.humanId };
    this.commands = [];
    this.auditEvents = [];
    this.replayHistoryComplete = true;
    return createGame(this.initialConfig, this.ruleset);
  }

  private restoreGameSequence(gameId: string): void {
    const match = localGameIdPattern.exec(gameId);
    if (!match) return;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence)) this.gameSequence = Math.max(this.gameSequence, sequence);
  }

  current(): SessionUpdate { return this.makeUpdate([]); }

  restart(): SessionUpdate {
    this.state = this.createFreshGame();
    this.events = [];
    this.processed.clear();
    this.commandSequence = 0;
    return this.persistAndReturn([]);
  }

  submit(command: GameCommand): SessionUpdate {
    const envelope: CommandEnvelope = { protocolVersion: 1, gameId: this.state.gameId, commandId: this.nextCommandId(this.humanId), actorId: this.humanId, expectedRevision: this.state.revision, command };
    return this.submitEnvelope(envelope);
  }

  private nextCommandId(actorId: string): string {
    this.commandSequence += 1;
    return `${actorId}-${this.state.revision + 1}-${this.commandSequence}`;
  }

  private submitEnvelope(envelope: CommandEnvelope): SessionUpdate {
    const duplicate = this.processed.get(envelope.commandId);
    if (duplicate) return duplicate;
    const priorCursor = this.state.eventLogCursor;
    const pendingRootCommandId = this.pendingRootCommandId(this.state);
    const result = dispatch(this.state, this.ruleset, envelope);
    this.state = result.state;
    if (result.error) {
      this.rollbackCommandHistoryIfNeeded(pendingRootCommandId);
      return this.persistAndReturn([], result.error);
    }
    const committedEvents = this.committedEvents(priorCursor, result.events);
    this.events.push(...committedEvents);
    this.recordAccepted(envelope, committedEvents);
    const aiError = this.runAi();
    const update = this.persistAndReturn(committedEvents, aiError);
    this.processed.set(envelope.commandId, update);
    return update;
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
      saveLocalGame(serializeSnapshot(this.state), this.events, this.replayHistoryComplete ? this.replayBundle() : undefined);
      this.persistenceState = 'saved';
    } catch {
      this.persistenceState = 'memory-only';
    }
    return this.makeUpdate(newEvents, error);
  }

  private makeUpdate(_newEvents: DomainEvent[], error?: EngineError): SessionUpdate {
    const legalCommands = getLegalCommands(this.state, this.ruleset, this.humanId);
    const update: SessionUpdate = {
      view: projectPlayerView(this.state, this.ruleset, this.humanId),
      definitions: this.ruleset.registry.definitions,
      events: this.events.slice(-60),
      legalCommands,
      actionPreviews: getActionPreviewSet(this.state, this.ruleset, this.humanId),
      entrySummary: {
        schemaVersion: 1,
        canContinue: this.persistenceState === 'restored',
        gameId: this.state.gameId,
        revision: this.state.revision,
        round: this.state.round,
        phase: this.state.phase,
        status: this.state.status,
        replayHistoryComplete: this.replayHistoryComplete,
      },
      persistence: {
        schemaVersion: 1,
        state: this.persistenceState,
        revision: this.state.revision,
        replayHistoryComplete: this.replayHistoryComplete,
      },
      replayHistoryComplete: this.replayHistoryComplete,
      error,
    };
    return { ...update, scoreboard: this.state.status === 'finished' ? getScoreboard(this.state, this.ruleset) : undefined };
  }

  private recordAccepted(envelope: CommandEnvelope, events: readonly DomainEvent[]): void {
    this.commands.push(structuredClone(envelope));
    this.auditEvents.push(...structuredClone(events));
  }

  private replayBundle(): ReplayBundle {
    return { schemaVersion: 1, protocolVersion: 1, registry: replayRegistryFingerprint(this.ruleset), initialConfig: structuredClone(this.initialConfig), commands: structuredClone(this.commands), expectedEvents: structuredClone(this.auditEvents), expectedFinalSnapshot: serializeSnapshot(this.state) };
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
    if (result.status === 'completed') return { status: 'completed', message: 'Replay 完成，沒有偵測到 divergence。', commandCount: Array.isArray((bundle as { commands?: unknown }).commands) ? (bundle as { commands: unknown[] }).commands.length : 0, eventCount: result.events.length, revision: result.finalSnapshot.state.revision };
    const diagnostic = result.diagnostic;
    return { status: 'failed', message: diagnostic.message, reasonCode: diagnostic.reasonCode, commandIndex: diagnostic.commandIndex, commandId: diagnostic.commandId, expectedRevision: diagnostic.expectedRevision, actualRevision: diagnostic.actualRevision, engineErrorCode: diagnostic.engineErrorCode, ...(diagnostic.divergence ? { divergence: structuredClone(diagnostic.divergence) } : {}) };
  }
}
