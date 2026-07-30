import { ReplayBundleSchema, type DomainEvent, type ReplayBundle, type VersionedSnapshot } from '@guildmaster/game-protocol';

const storageKey = 'guildmaster-mvp-save-v2';
const legacyStorageKey = 'guildmaster-mvp-snapshot-v1';
const legacyEventKey = 'guildmaster-mvp-events-v1';

export type LoadedLocalGame = { snapshot: VersionedSnapshot; events: DomainEvent[]; replayBundle?: ReplayBundle; replayHistoryComplete: boolean };

export function saveLocalGame(snapshot: VersionedSnapshot, events: readonly DomainEvent[], replayBundle?: ReplayBundle): void {
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, snapshot, events: events.slice(-60), ...(replayBundle ? { replayBundle } : {}) }));
}
export function clearLocalGame(): void { try { localStorage.removeItem(storageKey); localStorage.removeItem(legacyStorageKey); localStorage.removeItem(legacyEventKey); } catch { /* Storage can be unavailable; the in-memory session remains usable. */ } }

export function loadLocalGame(): LoadedLocalGame | undefined {
  try {
    const current = localStorage.getItem(storageKey);
    const value: unknown = current ? JSON.parse(current) : undefined;
    if (value && typeof value === 'object' && 'snapshot' in value && 'events' in value && Array.isArray(value.events) && value.events.every(isDomainEvent)) {
      const record = value as Record<string, unknown>;
      if (record.schemaVersion === 3) {
        const replay = ReplayBundleSchema.safeParse(record.replayBundle);
        return replay.success
          ? { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayBundle: replay.data as ReplayBundle, replayHistoryComplete: true }
          : { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayHistoryComplete: false };
      }
      // v2 stored only a Snapshot and a display-event tail; it has no authoritative command history.
      return { snapshot: record.snapshot as VersionedSnapshot, events: record.events as DomainEvent[], replayHistoryComplete: false };
    }
    const legacySnapshot = localStorage.getItem(legacyStorageKey);
    if (!legacySnapshot) return undefined;
    const events: unknown = JSON.parse(localStorage.getItem(legacyEventKey) ?? '[]');
    if (!Array.isArray(events) || !events.every(isDomainEvent)) throw new Error('Malformed stored events.');
    // v1 predates the local-save envelope. Preserve its Snapshot, never fabricate commands.
    return { snapshot: JSON.parse(legacySnapshot) as VersionedSnapshot, events, replayHistoryComplete: false };
  } catch {
    clearLocalGame();
    return undefined;
  }
}

function isDomainEvent(value: unknown): value is DomainEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string' && Number.isFinite(event.revision) && typeof event.type === 'string' && typeof event.message === 'string';
}
