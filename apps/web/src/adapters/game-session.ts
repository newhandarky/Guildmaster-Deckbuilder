import type { ScoreRow } from '@guildmaster/game-engine';
import type {
  ActionPreviewSet,
  CardDefinition,
  DomainEvent,
  EngineError,
  GameCommand,
  GameStatus,
  Phase,
  PlayerView,
  ReplayDiagnostic,
} from '@guildmaster/game-protocol';

export type SessionPersistenceStatus = {
  schemaVersion: 1;
  state: 'fresh' | 'restored' | 'saved' | 'memory-only';
  revision: number;
  replayHistoryComplete: boolean;
};

export type SessionEntrySummary = {
  schemaVersion: 2;
  contentMode: 'demo' | 'provisional-playtest';
  contentPackId: string;
  canContinue: boolean;
  gameId: string;
  revision: number;
  round: number;
  phase: Phase;
  status: GameStatus;
  replayHistoryComplete: boolean;
};

export type SessionUpdate = {
  view: PlayerView;
  definitions: Readonly<Record<string, CardDefinition>>;
  events: DomainEvent[];
  legalCommands: GameCommand[];
  actionPreviews: ActionPreviewSet;
  entrySummary: SessionEntrySummary;
  persistence: SessionPersistenceStatus;
  replayHistoryComplete: boolean;
  error?: EngineError | undefined;
  scoreboard?: ScoreRow[] | undefined;
};

export type ReplayDiagnosticExport = { json?: string; error?: string };

export type ReplayRunnerReport =
  | { status: 'completed'; message: string; commandCount: number; eventCount: number; revision: number }
  | {
      status: 'failed';
      message: string;
      reasonCode?: ReplayDiagnostic['reasonCode'] | undefined;
      commandIndex?: number | undefined;
      commandId?: string | undefined;
      expectedRevision?: number | undefined;
      actualRevision?: number | undefined;
      engineErrorCode?: string | undefined;
      divergence?: { path: string; expected: unknown; actual: unknown } | undefined;
    };
