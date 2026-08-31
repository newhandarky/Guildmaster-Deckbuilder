import type { DomainEvent } from '@guildmaster/game-protocol';
import { eventDisplayMessage } from './event-copy.js';

type Props = {
  events: readonly DomainEvent[];
};

export function ActivityPanel({ events }: Props) {
  const latestEvent = events.at(-1);
  const priorEvents = events.slice(-12, -1).reverse();
  const latestEventContent = latestEvent ? <>
    <small>最新結果 · 修訂 {latestEvent.revision}</small>
    <strong>{eventDisplayMessage(latestEvent)}</strong>
  </> : null;
  return <aside className="activity-rail" data-testid="activity-rail" aria-label="對局活動">
    <section className="log" aria-labelledby="event-log-title">
      <h2 id="event-log-title">事件紀錄</h2>
      {!latestEvent
        ? <p>等待你的第一個行動。</p>
        : <div className="latest-event" data-testid="latest-event">{latestEventContent}</div>}
      {priorEvents.length > 0 ? <ol className="event-list" aria-label="較早事件">
        {priorEvents.map((item) => <li key={item.eventId}>{eventDisplayMessage(item)}</li>)}
      </ol> : null}
    </section>
  </aside>;
}
