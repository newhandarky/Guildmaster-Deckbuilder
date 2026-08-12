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
const cpuPreferenceKey = 'guildmaster-cpu-ui-preference-v1';
function loadCpuPreference(): { paused: boolean; speed: CpuSpeed } {
  try { const value = JSON.parse(localStorage.getItem(cpuPreferenceKey) ?? 'null') as { paused?: unknown; speed?: unknown } | null; return { paused: typeof value?.paused === 'boolean' ? value.paused : false, speed: ['slow', 'normal', 'fast', 'instant'].includes(String(value?.speed)) ? value!.speed as CpuSpeed : 'normal' }; }
  catch { return { paused: false, speed: 'normal' }; }
}
const cpuPreference = loadCpuPreference();

export type CpuSpeed = 'slow' | 'normal' | 'fast' | 'instant';
type GameStore = SessionUpdate & { replayReport: ReplayRunnerReport | undefined; cpuPaused: boolean; cpuSpeed: CpuSpeed; submit: (command: GameCommand) => void; stepCpu: () => void; setCpuPaused: (paused: boolean) => void; setCpuSpeed: (speed: CpuSpeed) => void; restart: (setup?: WebGameSetup) => void; loadCurrentReplay: () => string | undefined; runReplay: (source: string) => void; clearReplayReport: () => void };

function current(): SessionUpdate { return session.current(); }
function settlePersistence(set: (partial: Partial<GameStore>) => void): void {
  const activeSession = session;
  void activeSession.whenPersistenceSettled().then((update) => { if (session === activeSession) set(update); });
}

export const useGameStore = create<GameStore>((set) => ({
  ...current(),
  replayReport: undefined,
  cpuPaused: cpuPreference.paused,
  cpuSpeed: cpuPreference.speed,
  submit: (command) => { set({ ...session.submit(command), replayReport: undefined }); settlePersistence(set); },
  stepCpu: () => { set({ ...session.stepCpu(), replayReport: undefined }); settlePersistence(set); },
  setCpuPaused: (cpuPaused) => { try { localStorage.setItem(cpuPreferenceKey, JSON.stringify({ paused: cpuPaused, speed: useGameStore.getState().cpuSpeed })); } catch { /* preference persistence is optional */ } set({ cpuPaused }); },
  setCpuSpeed: (cpuSpeed) => { try { localStorage.setItem(cpuPreferenceKey, JSON.stringify({ paused: useGameStore.getState().cpuPaused, speed: cpuSpeed })); } catch { /* preference persistence is optional */ } set({ cpuSpeed }); },
  restart: (setup = gameSetup) => {
    if (!scenario && JSON.stringify(setup) !== JSON.stringify(gameSetup)) {
      gameSetup = structuredClone(setup);
      session = new LocalGameSession(createWebRuleset(undefined, gameSetup));
    }
    set({ ...session.restart(), replayReport: undefined });
    settlePersistence(set);
  },
  loadCurrentReplay: () => { const exported = session.exportReplayDiagnostic(); if (exported.json) return exported.json; set({ replayReport: { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗。' } }); return undefined; },
  runReplay: (source) => set({ replayReport: session.runReplayDiagnosticJson(source) }),
  clearReplayReport: () => set({ replayReport: undefined })
}));
