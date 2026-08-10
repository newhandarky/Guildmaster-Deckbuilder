import type { GameCommand } from '@guildmaster/game-protocol';
import { create } from 'zustand';
import type { ReplayRunnerReport, SessionUpdate } from '../adapters/game-session.js';
import { LocalGameSession } from '../adapters/local-session/LocalGameSession.js';
import { loadLocalGame } from '../adapters/local-session/local-storage.js';
import { resolveE2EScenario } from '../app/e2e-scenarios.js';
import { createWebRuleset, webContentModeFromPackIds, type WebContentMode } from '../app/ruleset.js';

const scenario = resolveE2EScenario(window.location.search);
const loaded = scenario ? undefined : loadLocalGame();
let contentMode: WebContentMode = loaded?.status === 'loaded'
  ? webContentModeFromPackIds(loaded.game.snapshot.contentPacks.map(({ id }) => id))
  : 'demo';
let session = new LocalGameSession(createWebRuleset(scenario, contentMode));

type GameStore = SessionUpdate & { replayReport: ReplayRunnerReport | undefined; submit: (command: GameCommand) => void; restart: (mode?: WebContentMode) => void; loadCurrentReplay: () => string | undefined; runReplay: (source: string) => void; clearReplayReport: () => void };

function current(): SessionUpdate { return session.current(); }

export const useGameStore = create<GameStore>((set) => ({
  ...current(),
  replayReport: undefined,
  submit: (command) => set({ ...session.submit(command), replayReport: undefined }),
  restart: (mode = contentMode) => {
    if (!scenario && mode !== contentMode) {
      contentMode = mode;
      session = new LocalGameSession(createWebRuleset(undefined, contentMode));
    }
    set({ ...session.restart(), replayReport: undefined });
  },
  loadCurrentReplay: () => { const exported = session.exportReplayDiagnostic(); if (exported.json) return exported.json; set({ replayReport: { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗。' } }); return undefined; },
  runReplay: (source) => set({ replayReport: session.runReplayDiagnosticJson(source) }),
  clearReplayReport: () => set({ replayReport: undefined })
}));
