import { simpleAiStrategy, asEnvelope } from '@guildmaster/game-ai';
import { createGame, dispatch, getLegalCommands, getScoreboard, projectPlayerView, restoreSnapshot, serializeSnapshot, type Ruleset, type ScoreRow } from '@guildmaster/game-engine';
import type { CommandEnvelope, DomainEvent, EngineError, GameCommand, GameState, PlayerView } from '@guildmaster/game-protocol';
import { loadLocalGame, saveLocalGame } from './local-storage.js';

export type SessionUpdate = { view: PlayerView; events: DomainEvent[]; legalCommands: GameCommand[]; error?: EngineError; scoreboard?: ScoreRow[] };

export class LocalGameSession {
  private state: GameState;
  private readonly processed = new Map<string, SessionUpdate>();
  private events: DomainEvent[];

  constructor(private readonly ruleset: Ruleset, private readonly humanId = 'human-1') {
    const saved = loadLocalGame();
    if (saved) {
      this.state = restoreSnapshot(saved.snapshot);
      this.events = saved.events;
    } else {
      this.state = this.createFreshGame();
      this.events = [];
    }
  }

  private createFreshGame(): GameState {
    return createGame({ gameId: `local-${Date.now()}`, seed: 20260726, players: [{ id: this.humanId, name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }], startingPlayerId: this.humanId }, this.ruleset);
  }

  current(): SessionUpdate { return this.makeUpdate([]); }

  restart(): SessionUpdate {
    this.state = this.createFreshGame();
    this.events = [];
    this.processed.clear();
    return this.persistAndReturn([]);
  }

  submit(command: GameCommand): SessionUpdate {
    const envelope: CommandEnvelope = { protocolVersion: 1, gameId: this.state.gameId, commandId: `human-${this.state.revision + 1}`, actorId: this.humanId, expectedRevision: this.state.revision, command };
    return this.submitEnvelope(envelope);
  }

  private submitEnvelope(envelope: CommandEnvelope): SessionUpdate {
    const duplicate = this.processed.get(envelope.commandId);
    if (duplicate) return duplicate;
    const result = dispatch(this.state, this.ruleset, envelope);
    if (result.error) return this.makeUpdate([], result.error);
    this.state = result.state;
    this.events.push(...result.events);
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
      const result = dispatch(this.state, this.ruleset, asEnvelope(view, active.id, command));
      if (result.error) return;
      this.state = result.state;
      this.events.push(...result.events);
    }
  }

  private persistAndReturn(newEvents: DomainEvent[]): SessionUpdate {
    saveLocalGame(serializeSnapshot(this.state), this.events);
    return this.makeUpdate(newEvents);
  }

  private makeUpdate(_newEvents: DomainEvent[], error?: EngineError): SessionUpdate {
    const legalCommands = getLegalCommands(this.state, this.ruleset, this.humanId);
    const update: SessionUpdate = { view: projectPlayerView(this.state, this.ruleset, this.humanId), events: this.events.slice(-60), legalCommands, ...(error ? { error } : {}) };
    return this.state.status === 'finished' ? { ...update, scoreboard: getScoreboard(this.state, this.ruleset) } : update;
  }
}
