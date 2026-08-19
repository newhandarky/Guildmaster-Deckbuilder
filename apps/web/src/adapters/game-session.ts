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
  ReplayAutomationDecision,
} from '@guildmaster/game-protocol';

export type SessionPersistenceStatus = {
  schemaVersion: 2;
  state: 'fresh' | 'restored' | 'saving' | 'saved' | 'memory-only';
  revision: number;
  replayHistoryComplete: boolean;
  recoveryReason?: 'INVALID_SAVE' | 'REGISTRY_MISMATCH' | 'REPLAY_DIVERGENCE' | 'CPU_PROFILE_MISMATCH';
  recovery?: {
    reasonCode: 'helper-rules-upgraded' | 'card-rules-upgraded';
    previousPackVersion: string;
    previousModuleVersion: string;
  } | undefined;
};

export type SessionEntrySummary = {
  schemaVersion: 3;
  contentMode: 'demo' | 'provisional-playtest' | 'provisional-original-full' | 'custom-adventurers-full';
  advancedRules: { helpers: boolean };
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
  bondDefinitions: readonly { id: string; name: string; honor: number; requiredBosses: number }[];
  events: DomainEvent[];
  legalCommands: GameCommand[];
  actionPreviews: ActionPreviewSet;
  entrySummary: SessionEntrySummary;
  persistence: SessionPersistenceStatus;
  replayHistoryComplete: boolean;
  cpu: {
    profileId: string; profileVersion: string;
    status: 'idle' | 'ready' | 'blocked';
    nextActorId?: string;
    stepKey: string;
    diagnostic?: string;
    decisions: readonly ReplayAutomationDecision[];
  };
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
