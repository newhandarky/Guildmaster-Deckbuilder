import type { GameCommand } from '@guildmaster/game-protocol';
import { create } from 'zustand';
import type { ReplayRunnerReport, SessionUpdate } from '../adapters/game-session.js';
import { LocalGameSession } from '../adapters/local-session/LocalGameSession.js';
import { loadLocalGame } from '../adapters/local-session/local-storage.js';
import { resolveE2EScenario } from '../app/e2e-scenarios.js';
import { createWebRuleset, defaultWebGameSetup, webGameSetupFromSnapshot, type WebGameSetup } from '../app/ruleset.js';

const scenario = resolveE2EScenario(window.location.search);
const loaded = scenario ? undefined : loadLocalGame();
function setupForLoadedGame(): WebGameSetup {
  if (loaded?.status !== 'loaded') return structuredClone(defaultWebGameSetup);
  try {
    return webGameSetupFromSnapshot(
      loaded.game.snapshot.contentPacks.map(({ id }) => id),
      loaded.game.snapshot.rulesModules.map(({ id }) => id),
    );
  } catch {
    return structuredClone(defaultWebGameSetup);
  }
}
let gameSetup: WebGameSetup = setupForLoadedGame();
let session = new LocalGameSession(createWebRuleset(scenario, gameSetup));

type GameStore = SessionUpdate & { replayReport: ReplayRunnerReport | undefined; submit: (command: GameCommand) => void; restart: (setup?: WebGameSetup) => void; loadCurrentReplay: () => string | undefined; runReplay: (source: string) => void; clearReplayReport: () => void };

function current(): SessionUpdate { return session.current(); }

export const useGameStore = create<GameStore>((set) => ({
  ...current(),
  replayReport: undefined,
  submit: (command) => set({ ...session.submit(command), replayReport: undefined }),
  restart: (setup = gameSetup) => {
    if (!scenario && JSON.stringify(setup) !== JSON.stringify(gameSetup)) {
      gameSetup = structuredClone(setup);
      session = new LocalGameSession(createWebRuleset(undefined, gameSetup));
    }
    set({ ...session.restart(), replayReport: undefined });
  },
  loadCurrentReplay: () => { const exported = session.exportReplayDiagnostic(); if (exported.json) return exported.json; set({ replayReport: { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗。' } }); return undefined; },
  runReplay: (source) => set({ replayReport: session.runReplayDiagnosticJson(source) }),
  clearReplayReport: () => set({ replayReport: undefined })
}));
