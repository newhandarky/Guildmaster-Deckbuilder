import type { DomainEvent } from '@guildmaster/game-protocol';
import { eventDisplayMessage } from './event-copy.js';

type Props = { event?: DomainEvent | undefined };

export function LatestEventStatus({ event }: Props) {
  if (!event) return null;

  return <output
    className="compact-latest-event"
    data-testid="compact-latest-event"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <small>最新</small>
    <span>{eventDisplayMessage(event)}</span>
  </output>;
}
