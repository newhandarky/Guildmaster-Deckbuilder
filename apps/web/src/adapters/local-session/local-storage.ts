import { DomainEventSchema, ReplayAutomationSchema, ReplayBundleSchema, SnapshotEnvelopeSchema, type DomainEvent, type ReplayAutomationDecision, type ReplayBundle, type ReplaySessionConfig, type VersionedSnapshot } from '@guildmaster/game-protocol';
import { indexedDbSessionRepository, serializedIndexedDbSessionPersistence } from './indexed-db.js';

const storageKey = 'guildmaster-mvp-save-v2';
const legacyStorageKey = 'guildmaster-mvp-snapshot-v1';
const legacyEventKey = 'guildmaster-mvp-events-v1';
const summaryStorageKey = 'guildmaster-mvp-entry-summary-v1';
const usesIndexedDb = (import.meta.env.PROD || (globalThis as { __GUILDMASTER_FORCE_INDEXED_DB__?: boolean }).__GUILDMASTER_FORCE_INDEXED_DB__ === true) && typeof indexedDB !== 'undefined';
let hydratedIndexedDbResult: LoadLocalGameResult | undefined;

export type CpuAutomationState = { profileId: string; profileVersion: string; runner: { autonomousSteps: number; turnActions: [string, number][]; visibleStates: [string, number][] }; decisions: ReplayAutomationDecision[] };
export type LoadedLocalGame = { snapshot: VersionedSnapshot; events: DomainEvent[]; replayBundle?: ReplayBundle; replayHistoryComplete: boolean; cpuAutomation?: CpuAutomationState; sessionConfig: ReplaySessionConfig };
export type LoadLocalGameResult =
  | { status: 'empty' }
  | { status: 'loaded'; game: LoadedLocalGame }
  | { status: 'invalid-cleared' }
  | { status: 'unavailable' };

type LocalSaveEnvelope = {
  schemaVersion: 5;
  snapshot: VersionedSnapshot;
  events: readonly DomainEvent[];
  replayBundle?: ReplayBundle;
  cpuAutomation?: CpuAutomationState;
  sessionConfig: ReplaySessionConfig;
};
export type PersistenceReceipt = { durable: true } | { durable: false; completion: Promise<void> };

function createEnvelope(snapshot: VersionedSnapshot, events: readonly DomainEvent[], sessionConfig: ReplaySessionConfig, replayBundle?: ReplayBundle, cpuAutomation?: CpuAutomationState): LocalSaveEnvelope {
  return { schemaVersion: 5, snapshot, events: events.slice(-60), sessionConfig, ...(replayBundle ? { replayBundle } : {}), ...(cpuAutomation ? { cpuAutomation } : {}) };
}

export function saveLocalGame(snapshot: VersionedSnapshot, events: readonly DomainEvent[], sessionConfig: ReplaySessionConfig, replayBundle?: ReplayBundle, cpuAutomation?: CpuAutomationState): PersistenceReceipt {
  const envelope = createEnvelope(snapshot, events, sessionConfig, replayBundle, cpuAutomation);
  if (usesIndexedDb) {
    hydratedIndexedDbResult = parseLocalSave(envelope);
    const completion = serializedIndexedDbSessionPersistence.write(envelope).then(() => {
      try { localStorage.setItem(summaryStorageKey, JSON.stringify({ schemaVersion: 1, gameId: snapshot.state.gameId, revision: snapshot.state.revision, round: snapshot.state.round, status: snapshot.state.status })); }
      catch { /* The compact summary is optional; IndexedDB is authoritative. */ }
    });
    return { durable: false, completion };
  }
  localStorage.setItem(storageKey, JSON.stringify(envelope));
  return { durable: true };
}
export function clearLocalGame(): PersistenceReceipt {
  hydratedIndexedDbResult = { status: 'empty' };
  const indexedDbClear = usesIndexedDb ? serializedIndexedDbSessionPersistence.clear() : undefined;
  let localStorageAvailable = true;
  for (const key of [storageKey, legacyStorageKey, legacyEventKey, summaryStorageKey]) {
    try { localStorage.removeItem(key); }
    catch { localStorageAvailable = false; }
  }
  if (indexedDbClear) return { durable: false, completion: indexedDbClear };
  return localStorageAvailable ? { durable: true } : { durable: false, completion: Promise.reject(new Error('Local persistence is unavailable.')) };
}

export function loadLocalGame(): LoadLocalGameResult {
  if (usesIndexedDb && hydratedIndexedDbResult) return hydratedIndexedDbResult;
  let current: string | null;
  try {
    current = localStorage.getItem(storageKey);
  } catch {
    return { status: 'unavailable' };
  }

  if (current) {
    try {
      const result = parseLocalSave(JSON.parse(current));
      if (result.status === 'loaded') return result;
    } catch {
      // Invalid current saves are handled below with the same recoverable clear path.
    }
    const cleared = clearLocalGame();
    if (!cleared.durable) void cleared.completion.catch(() => undefined);
    return { status: cleared.durable || usesIndexedDb ? 'invalid-cleared' : 'unavailable' };
  }

  try {
    const legacySnapshot = localStorage.getItem(legacyStorageKey);
    if (!legacySnapshot) return { status: 'empty' };
    const legacyEvents = localStorage.getItem(legacyEventKey);
    const snapshot = SnapshotEnvelopeSchema.safeParse(JSON.parse(legacySnapshot));
    const events: unknown = JSON.parse(legacyEvents ?? '[]');
    if (!snapshot.success || isFullFourPlayerSnapshot(snapshot.data) || !Array.isArray(events) || !events.every(isDomainEvent)) throw new Error('Malformed or unauditable legacy save.');
    // v1 predates the local-save envelope. Preserve its Snapshot, never fabricate commands.
    return { status: 'loaded', game: { snapshot: snapshot.data as VersionedSnapshot, events, replayHistoryComplete: false, sessionConfig: { schemaVersion: 1, cpuDifficulty: 'challenge' } } };
  } catch {
    const cleared = clearLocalGame();
    if (!cleared.durable) void cleared.completion.catch(() => undefined);
    return { status: cleared.durable || usesIndexedDb ? 'invalid-cleared' : 'unavailable' };
  }
}

/** Production bootstrap must await this before importing the application store. */
export async function hydrateLocalGameFromIndexedDb(): Promise<void> {
  if (!usesIndexedDb) return;
  try {
    const persisted = await indexedDbSessionRepository.read();
    if (persisted !== undefined) {
      const parsed = parseLocalSave(persisted);
      if (parsed.status === 'loaded') {
        hydratedIndexedDbResult = parsed;
        return;
      }
      await indexedDbSessionRepository.clear();
      hydratedIndexedDbResult = { status: 'invalid-cleared' };
      return;
    }
    // One-time migration from the former localStorage envelope.
    const legacyCurrent = localStorage.getItem(storageKey);
    if (legacyCurrent) {
      const parsed = parseLocalSave(JSON.parse(legacyCurrent));
      if (parsed.status === 'loaded') {
        await indexedDbSessionRepository.write(JSON.parse(legacyCurrent));
        localStorage.removeItem(storageKey);
        hydratedIndexedDbResult = parsed;
        return;
      }
    }
    hydratedIndexedDbResult = { status: 'empty' };
  } catch {
    hydratedIndexedDbResult = { status: 'unavailable' };
  }
}

function parseLocalSave(value: unknown): LoadLocalGameResult {
  if (!value || typeof value !== 'object' || !('snapshot' in value) || !('events' in value)) return { status: 'invalid-cleared' };
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.events) || !record.events.every(isDomainEvent)) return { status: 'invalid-cleared' };
  if (record.schemaVersion === 5 || record.schemaVersion === 4 || record.schemaVersion === 3) {
    const snapshot = SnapshotEnvelopeSchema.safeParse(record.snapshot);
    const events = record.events.map((event) => DomainEventSchema.safeParse(event));
    if (!snapshot.success || events.some((event) => !event.success)) return { status: 'invalid-cleared' };
    const replay = ReplayBundleSchema.safeParse(record.replayBundle);
    const automation = record.schemaVersion === 5 || record.schemaVersion === 4 ? ReplayAutomationSchema.safeParse(record.cpuAutomation) : undefined;
    const replaySessionConfig = replay.success && replay.data.schemaVersion === 3 ? replay.data.sessionConfig : undefined;
    const rawSessionConfig = record.schemaVersion === 5 ? record.sessionConfig : replaySessionConfig ?? { schemaVersion: 1, cpuDifficulty: 'challenge' };
    const sessionConfig = rawSessionConfig && typeof rawSessionConfig === 'object' && (rawSessionConfig as ReplaySessionConfig).schemaVersion === 1 && ['beginner', 'standard', 'challenge'].includes((rawSessionConfig as ReplaySessionConfig).cpuDifficulty)
      ? structuredClone(rawSessionConfig as ReplaySessionConfig) : undefined;
    const isFullFourPlayer = isFullFourPlayerSnapshot(snapshot.data);
    if (!sessionConfig) return { status: 'invalid-cleared' };
    if (replaySessionConfig && JSON.stringify(replaySessionConfig) !== JSON.stringify(sessionConfig)) return { status: 'invalid-cleared' };
    if ((record.schemaVersion === 5 || record.schemaVersion === 4) && record.replayBundle !== undefined && !replay.success) return { status: 'invalid-cleared' };
    if ((record.schemaVersion === 5 || record.schemaVersion === 4) && record.cpuAutomation !== undefined && !automation?.success) return { status: 'invalid-cleared' };
    if (isFullFourPlayer && ((record.schemaVersion !== 5 && record.schemaVersion !== 4) || !replay.success || (replay.data.schemaVersion !== 2 && replay.data.schemaVersion !== 3) || !replay.data.expectedEvents || !replay.data.expectedFinalSnapshot || !automation?.success)) return { status: 'invalid-cleared' };
    const cpuAutomation = automation?.success ? automation.data as CpuAutomationState : undefined;
    const parsedEvents = events.map((event) => event.data!) as DomainEvent[];
    return { status: 'loaded', game: replay.success
      ? { snapshot: snapshot.data as VersionedSnapshot, events: parsedEvents, replayBundle: replay.data as ReplayBundle, replayHistoryComplete: Boolean(replay.data.expectedEvents && replay.data.expectedFinalSnapshot), sessionConfig, ...(cpuAutomation ? { cpuAutomation } : {}) }
      : { snapshot: snapshot.data as VersionedSnapshot, events: parsedEvents, replayHistoryComplete: false, sessionConfig, ...(cpuAutomation ? { cpuAutomation } : {}) } };
  }
  if (record.schemaVersion === 2) {
    const snapshot = SnapshotEnvelopeSchema.safeParse(record.snapshot);
    if (!snapshot.success || isFullFourPlayerSnapshot(snapshot.data)) return { status: 'invalid-cleared' };
    return { status: 'loaded', game: { snapshot: snapshot.data as VersionedSnapshot, events: record.events as DomainEvent[], replayHistoryComplete: false, sessionConfig: { schemaVersion: 1, cpuDifficulty: 'challenge' } } };
  }
  return { status: 'invalid-cleared' };
}

function isFullFourPlayerSnapshot(snapshot: { contentPacks: readonly { id: string }[] }): boolean {
  return snapshot.contentPacks.some(({ id }) => id === 'base:provisional-original-full');
}

function isDomainEvent(value: unknown): value is DomainEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string' && Number.isFinite(event.revision) && typeof event.type === 'string' && typeof event.message === 'string';
}
