import type { DomainEvent } from '@guildmaster/game-protocol';
import type { ReactNode } from 'react';

type Props = {
  events: readonly DomainEvent[];
  diagnostics: ReactNode;
};

export function ActivityPanel({ events, diagnostics }: Props) {
  const latestEvent = events.at(-1);
  const priorEvents = events.slice(-12, -1).reverse();
  return <aside className="activity-rail" data-testid="activity-rail" aria-label="對局活動">
    <section className="log" aria-labelledby="event-log-title">
      <h2 id="event-log-title">事件紀錄</h2>
      {!latestEvent
        ? <p>等待你的第一個行動。</p>
        : <output className="latest-event" data-testid="latest-event" role="status" aria-live="polite" aria-atomic="true">
          <small>最新結果 · 修訂 {latestEvent.revision}</small>
          <strong>{latestEvent.message}</strong>
        </output>}
      {priorEvents.length > 0 ? <ol className="event-list" aria-label="較早事件">
        {priorEvents.map((item) => <li key={item.eventId}>{item.message}</li>)}
      </ol> : null}
    </section>
    {diagnostics}
  </aside>;
}
