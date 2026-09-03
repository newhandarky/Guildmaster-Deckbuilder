import type { GameCommand, ReplaySessionConfig } from '@guildmaster/game-protocol';
import { create } from 'zustand';
import type { ReplayRunnerReport, SessionUpdate } from '../adapters/game-session.js';
import { LocalGameSession } from '../adapters/local-session/LocalGameSession.js';
import { loadLocalGame } from '../adapters/local-session/local-storage.js';
import { downloadReplayJson, type ReplayDownloadResult } from '../adapters/replay-download.js';
import { resolveE2EScenario } from '../app/e2e-scenarios.js';
import { createWebRuleset, defaultWebGameSetup, webGameSetupFromSnapshot, type WebGameSetup } from '../app/ruleset.js';
import type { PresentationTransitionBatch } from '../ui/motion/types.js';
import { appendPresentationBatch, createPresentationTransitionBatch } from '../ui/motion/transition-batch.js';

const scenario = resolveE2EScenario(window.location.search);
const loaded = scenario ? undefined : loadLocalGame();
function setupForLoadedGame(): WebGameSetup {
  if (loaded?.status !== 'loaded') return structuredClone(defaultWebGameSetup);
  try {
    return webGameSetupFromSnapshot(
      loaded.game.snapshot.contentPacks.map(({ id }) => id),
      loaded.game.snapshot.rulesModules,
      loaded.game.sessionConfig,
    );
  } catch {
    return structuredClone(defaultWebGameSetup);
  }
}
let gameSetup: WebGameSetup = setupForLoadedGame();
const sessionConfigForSetup = (setup: WebGameSetup): ReplaySessionConfig => ({ schemaVersion: 1, cpuDifficulty: setup.cpuDifficulty, ...(setup.contentMode === 'custom-adventurers-full' ? { bossDeckSize: setup.customRules?.bossDeckSize ?? 6 } : {}) });
let session = new LocalGameSession(createWebRuleset(scenario, gameSetup), 'human-1', sessionConfigForSetup(gameSetup));
const cpuPreferenceKey = 'guildmaster-cpu-ui-preference-v1';
function loadCpuPreference(): { paused: boolean; speed: CpuSpeed } {
  try { const value = JSON.parse(localStorage.getItem(cpuPreferenceKey) ?? 'null') as { paused?: unknown; speed?: unknown } | null; return { paused: typeof value?.paused === 'boolean' ? value.paused : false, speed: ['slow', 'normal', 'fast', 'instant'].includes(String(value?.speed)) ? value!.speed as CpuSpeed : 'normal' }; }
  catch { return { paused: false, speed: 'normal' }; }
}
const cpuPreference = loadCpuPreference();

export type CpuSpeed = 'slow' | 'normal' | 'fast' | 'instant';
type GameStore = SessionUpdate & { presentationBatches: readonly PresentationTransitionBatch[]; replayReport: ReplayRunnerReport | undefined; cpuPaused: boolean; cpuSpeed: CpuSpeed; submit: (command: GameCommand) => void; stepCpu: () => void; acknowledgePresentationBatch: (batchId: string) => void; setCpuPaused: (paused: boolean) => void; setCpuSpeed: (speed: CpuSpeed) => void; restart: (setup?: WebGameSetup) => void; loadCurrentReplay: () => string | undefined; downloadCurrentReplay: () => ReplayDownloadResult; runReplay: (source: string) => void; clearReplayReport: () => void };

let batchSequence = 0;
function transitionBatch(before: SessionUpdate['view'], update: SessionUpdate, source: PresentationTransitionBatch['source']): PresentationTransitionBatch | undefined {
  batchSequence += 1;
  return createPresentationTransitionBatch(before, update, source, `${update.view.gameId}:${before.revision}:${update.view.revision}:${batchSequence}`);
}

function current(): SessionUpdate { return session.current(); }
function settlePersistence(set: (partial: Partial<GameStore>) => void): void {
  const activeSession = session;
  void activeSession.whenPersistenceSettled().then((update) => { if (session === activeSession) set(update); });
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...current(),
  presentationBatches: [],
  replayReport: undefined,
  cpuPaused: cpuPreference.paused,
  cpuSpeed: cpuPreference.speed,
  submit: (command) => {
    const before = get().view;
    const update = session.submit(command);
    const batch = transitionBatch(before, update, 'human');
    set({ ...update, replayReport: undefined, presentationBatches: batch ? appendPresentationBatch(get().presentationBatches, batch) : get().presentationBatches });
    settlePersistence(set);
  },
  stepCpu: () => {
    const before = get().view;
    const update = session.stepCpu();
    const batch = transitionBatch(before, update, 'cpu');
    set({ ...update, replayReport: undefined, presentationBatches: batch ? appendPresentationBatch(get().presentationBatches, batch) : get().presentationBatches });
    settlePersistence(set);
  },
  acknowledgePresentationBatch: (batchId) => set(({ presentationBatches }) => ({ presentationBatches: presentationBatches.filter((batch) => batch.batchId !== batchId) })),
  setCpuPaused: (cpuPaused) => { try { localStorage.setItem(cpuPreferenceKey, JSON.stringify({ paused: cpuPaused, speed: useGameStore.getState().cpuSpeed })); } catch { /* preference persistence is optional */ } set({ cpuPaused }); },
  setCpuSpeed: (cpuSpeed) => { try { localStorage.setItem(cpuPreferenceKey, JSON.stringify({ paused: useGameStore.getState().cpuPaused, speed: cpuSpeed })); } catch { /* preference persistence is optional */ } set({ cpuSpeed }); },
  restart: (setup = gameSetup) => {
    if (!scenario && JSON.stringify(setup) !== JSON.stringify(gameSetup)) {
      gameSetup = structuredClone(setup);
      session = new LocalGameSession(createWebRuleset(undefined, gameSetup), 'human-1', sessionConfigForSetup(gameSetup));
    }
    set({ ...session.restart(), replayReport: undefined, presentationBatches: [] });
    settlePersistence(set);
  },
  loadCurrentReplay: () => { const exported = session.exportReplayDiagnostic(); if (exported.json) return exported.json; set({ replayReport: { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗。' } }); return undefined; },
  downloadCurrentReplay: () => downloadReplayJson(session.exportReplayDiagnostic(), get().view.gameId),
  runReplay: (source) => set({ replayReport: session.runReplayDiagnosticJson(source) }),
  clearReplayReport: () => set({ replayReport: undefined })
}));
