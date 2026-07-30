import { simpleAiStrategy, asEnvelope } from '@guildmaster/game-ai';
import { createGame, dispatch, getLegalCommands, getScoreboard, projectPlayerView, replayGame, replayRegistryFingerprint, restoreSnapshot, serializeSnapshot, type Ruleset, type ScoreRow } from '@guildmaster/game-engine';
import type { CardDefinition, CommandEnvelope, DomainEvent, EngineError, GameCommand, GameState, PlayerView, ReplayBundle, ReplayDiagnostic, ReplayInitialConfig } from '@guildmaster/game-protocol';
import { clearLocalGame, loadLocalGame, saveLocalGame } from './local-storage.js';

export type SessionUpdate = { view: PlayerView; definitions: Readonly<Record<string, CardDefinition>>; events: DomainEvent[]; legalCommands: GameCommand[]; replayHistoryComplete: boolean; error?: EngineError; scoreboard?: ScoreRow[] };
export type ReplayDiagnosticExport = { json?: string; error?: string };
export type ReplayRunnerReport = { status: 'completed'; message: string; commandCount: number; eventCount: number; revision: number } | { status: 'failed'; message: string; reasonCode?: ReplayDiagnostic['reasonCode'] | undefined; commandIndex?: number | undefined; commandId?: string | undefined; expectedRevision?: number | undefined; actualRevision?: number | undefined; engineErrorCode?: string | undefined; divergence?: { path: string; expected: unknown; actual: unknown } | undefined };

export class LocalGameSession {
  private state: GameState;
  private readonly processed = new Map<string, SessionUpdate>();
  private events: DomainEvent[];
  private auditEvents: DomainEvent[] = [];
  private commands: CommandEnvelope[] = [];
  private initialConfig!: ReplayInitialConfig;
  private replayHistoryComplete = true;
  private commandSequence = 0;
  private gameSequence = 0;

  constructor(private readonly ruleset: Ruleset, private readonly humanId = 'human-1') {
    const saved = loadLocalGame();
    if (saved) {
      try {
        this.state = restoreSnapshot(saved.snapshot, this.ruleset);
        this.events = saved.events;
        this.replayHistoryComplete = saved.replayHistoryComplete;
        if (saved.replayBundle) {
          this.initialConfig = structuredClone(saved.replayBundle.initialConfig);
          this.commands = structuredClone([...saved.replayBundle.commands]);
          this.auditEvents = structuredClone([...(saved.replayBundle.expectedEvents ?? [])]);
          this.commandSequence = this.commands.length;
        }
      } catch {
        clearLocalGame();
        this.state = this.createFreshGame();
        this.events = [];
      }
    } else {
      this.state = this.createFreshGame();
      this.events = [];
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
    const result = dispatch(this.state, this.ruleset, envelope);
    if (result.error) return this.makeUpdate([], result.error);
    this.state = result.state;
    this.events.push(...result.events);
    this.recordAccepted(envelope, result.events);
    this.runAi();
    const update = this.persistAndReturn(result.events);
    this.processed.set(envelope.commandId, update);
    return update;
  }

  private runAi(): void {
    for (let turns = 0; turns < 80 && this.state.status !== 'finished' && this.state.status !== 'pendingOfficialRuling'; turns += 1) {
      const active = this.state.players.find((player) => player.id === this.state.activePlayerId);
      if (!active || active.kind !== 'ai') return;
      const view = projectPlayerView(this.state, this.ruleset, active.id);
      const command = simpleAiStrategy.chooseCommand(view, getLegalCommands(this.state, this.ruleset, active.id));
      if (!command) return;
      const envelope = asEnvelope(view, active.id, command, this.nextCommandId(active.id));
      const result = dispatch(this.state, this.ruleset, envelope);
      if (result.error) return;
      this.state = result.state;
      this.events.push(...result.events);
      this.recordAccepted(envelope, result.events);
    }
  }

  private persistAndReturn(newEvents: DomainEvent[]): SessionUpdate {
    try { saveLocalGame(serializeSnapshot(this.state), this.events, this.replayHistoryComplete ? this.replayBundle() : undefined); return this.makeUpdate(newEvents); }
    catch { return this.makeUpdate(newEvents, { code: 'INVALID_COMMAND', message: '本機儲存不可用；目前進度只保留在記憶體中。' }); }
  }

  private makeUpdate(_newEvents: DomainEvent[], error?: EngineError): SessionUpdate {
    const legalCommands = getLegalCommands(this.state, this.ruleset, this.humanId);
    const update: SessionUpdate = { view: projectPlayerView(this.state, this.ruleset, this.humanId), definitions: this.ruleset.registry.definitions, events: this.events.slice(-60), legalCommands, replayHistoryComplete: this.replayHistoryComplete, ...(error ? { error } : {}) };
    return this.state.status === 'finished' ? { ...update, scoreboard: getScoreboard(this.state, this.ruleset) } : update;
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
