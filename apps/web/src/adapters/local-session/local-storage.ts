import { ReplayBundleSchema, type DomainEvent, type ReplayBundle, type VersionedSnapshot } from '@guildmaster/game-protocol';

const storageKey = 'guildmaster-mvp-save-v2';
const legacyStorageKey = 'guildmaster-mvp-snapshot-v1';
const legacyEventKey = 'guildmaster-mvp-events-v1';

export type CpuAutomationState = { profileId: string; profileVersion: string; runner: { autonomousSteps: number; turnActions: [string, number][]; visibleStates: [string, number][] }; decisions: { revision: number; actorId: string; command: import('@guildmaster/game-protocol').GameCommand; reasonCode: string; score: number }[] };
export type LoadedLocalGame = { snapshot: VersionedSnapshot; events: DomainEvent[]; replayBundle?: ReplayBundle; replayHistoryComplete: boolean; cpuAutomation?: CpuAutomationState };
export type LoadLocalGameResult =
  | { status: 'empty' }
  | { status: 'loaded'; game: LoadedLocalGame }
  | { status: 'invalid-cleared' }
  | { status: 'unavailable' };

export function saveLocalGame(snapshot: VersionedSnapshot, events: readonly DomainEvent[], replayBundle?: ReplayBundle, cpuAutomation?: CpuAutomationState): void {
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 4, snapshot, events: events.slice(-60), ...(replayBundle ? { replayBundle } : {}), ...(cpuAutomation ? { cpuAutomation } : {}) }));
}
export function clearLocalGame(): boolean {
  try {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(legacyStorageKey);
    localStorage.removeItem(legacyEventKey);
    return true;
  } catch {
    return false;
  }
}

export function loadLocalGame(): LoadLocalGameResult {
  let current: string | null;
  try {
    current = localStorage.getItem(storageKey);
  } catch {
    return { status: 'unavailable' };
  }

  if (current) {
    try {
      const value: unknown = JSON.parse(current);
      if (value && typeof value === 'object' && 'snapshot' in value && 'events' in value && Array.isArray(value.events) && value.events.every(isDomainEvent)) {
        const record = value as Record<string, unknown>;
        if (record.schemaVersion === 4 || record.schemaVersion === 3) {
          const replay = ReplayBundleSchema.safeParse(record.replayBundle);
          const cpuAutomation = record.schemaVersion === 4 && record.cpuAutomation && typeof record.cpuAutomation === 'object' ? record.cpuAutomation as CpuAutomationState : undefined;
          return { status: 'loaded', game: replay.success
            ? { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayBundle: replay.data as ReplayBundle, replayHistoryComplete: true, ...(cpuAutomation ? { cpuAutomation } : {}) }
            : { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayHistoryComplete: false, ...(cpuAutomation ? { cpuAutomation } : {}) } };
        }
        if (record.schemaVersion !== 2) throw new Error('Unsupported local save version.');
        // v2 stored only a Snapshot and a display-event tail; it has no authoritative command history.
        return { status: 'loaded', game: { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayHistoryComplete: false } };
      }
    } catch {
      // Invalid current saves are handled below with the same recoverable clear path.
    }
    return { status: clearLocalGame() ? 'invalid-cleared' : 'unavailable' };
  }

  try {
    const legacySnapshot = localStorage.getItem(legacyStorageKey);
    if (!legacySnapshot) return { status: 'empty' };
    const legacyEvents = localStorage.getItem(legacyEventKey);
    const events: unknown = JSON.parse(legacyEvents ?? '[]');
    if (!Array.isArray(events) || !events.every(isDomainEvent)) throw new Error('Malformed stored events.');
    // v1 predates the local-save envelope. Preserve its Snapshot, never fabricate commands.
    return { status: 'loaded', game: { snapshot: JSON.parse(legacySnapshot) as VersionedSnapshot, events, replayHistoryComplete: false } };
  } catch {
    return { status: clearLocalGame() ? 'invalid-cleared' : 'unavailable' };
  }
}

function isDomainEvent(value: unknown): value is DomainEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string' && Number.isFinite(event.revision) && typeof event.type === 'string' && typeof event.message === 'string';
}
