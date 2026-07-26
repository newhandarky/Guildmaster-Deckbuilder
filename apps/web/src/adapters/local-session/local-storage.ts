import type { DomainEvent, VersionedSnapshot } from '@guildmaster/game-protocol';

const storageKey = 'guildmaster-mvp-snapshot-v1';
const eventKey = 'guildmaster-mvp-events-v1';

export function saveLocalGame(snapshot: VersionedSnapshot, events: readonly DomainEvent[]): void {
  localStorage.setItem(storageKey, JSON.stringify(snapshot));
  localStorage.setItem(eventKey, JSON.stringify(events.slice(-60)));
}

export function loadLocalGame(): { snapshot: VersionedSnapshot; events: DomainEvent[] } | undefined {
  const rawSnapshot = localStorage.getItem(storageKey);
  if (!rawSnapshot) return undefined;
  try {
    return { snapshot: JSON.parse(rawSnapshot) as VersionedSnapshot, events: JSON.parse(localStorage.getItem(eventKey) ?? '[]') as DomainEvent[] };
  } catch {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(eventKey);
    return undefined;
  }
}
