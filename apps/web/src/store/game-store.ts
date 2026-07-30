import type { GameCommand } from '@guildmaster/game-protocol';
import { create } from 'zustand';
import { LocalGameSession, type ReplayRunnerReport, type SessionUpdate } from '../adapters/local-session/LocalGameSession.js';
import { ruleset } from '../app/ruleset.js';

const session = new LocalGameSession(ruleset);

type GameStore = SessionUpdate & { replayReport: ReplayRunnerReport | undefined; submit: (command: GameCommand) => void; restart: () => void; loadCurrentReplay: () => string | undefined; runReplay: (source: string) => void; clearReplayReport: () => void };

function current(): SessionUpdate { return session.current(); }

export const useGameStore = create<GameStore>((set) => ({
  ...current(),
  replayReport: undefined,
  submit: (command) => set({ ...session.submit(command), replayReport: undefined }),
  restart: () => set({ ...session.restart(), replayReport: undefined }),
  loadCurrentReplay: () => { const exported = session.exportReplayDiagnostic(); if (exported.json) return exported.json; set({ replayReport: { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗。' } }); return undefined; },
  runReplay: (source) => set({ replayReport: session.runReplayDiagnosticJson(source) }),
  clearReplayReport: () => set({ replayReport: undefined })
}));
