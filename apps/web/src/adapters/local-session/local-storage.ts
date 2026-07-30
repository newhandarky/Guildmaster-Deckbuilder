import type { DomainEvent, VersionedSnapshot } from '@guildmaster/game-protocol';

const storageKey = 'guildmaster-mvp-save-v2';
const legacyStorageKey = 'guildmaster-mvp-snapshot-v1';
const legacyEventKey = 'guildmaster-mvp-events-v1';

export function saveLocalGame(snapshot: VersionedSnapshot, events: readonly DomainEvent[]): void {
  localStorage.setItem(storageKey, JSON.stringify({ snapshot, events: events.slice(-60) }));
}
export function clearLocalGame(): void { try { localStorage.removeItem(storageKey); localStorage.removeItem(legacyStorageKey); localStorage.removeItem(legacyEventKey); } catch { /* Storage can be unavailable; the in-memory session remains usable. */ } }

export function loadLocalGame(): { snapshot: VersionedSnapshot; events: DomainEvent[] } | undefined {
  try {
    const current = localStorage.getItem(storageKey);
    const value: unknown = current ? JSON.parse(current) : undefined;
    if (value && typeof value === 'object' && 'snapshot' in value && 'events' in value && Array.isArray(value.events) && value.events.every(isDomainEvent)) return value as { snapshot: VersionedSnapshot; events: DomainEvent[] };
    const legacySnapshot = localStorage.getItem(legacyStorageKey);
    if (!legacySnapshot) return undefined;
    const events: unknown = JSON.parse(localStorage.getItem(legacyEventKey) ?? '[]');
    if (!Array.isArray(events) || !events.every(isDomainEvent)) throw new Error('Malformed stored events.');
    return { snapshot: JSON.parse(legacySnapshot) as VersionedSnapshot, events };
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
