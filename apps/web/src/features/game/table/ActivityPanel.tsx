import type { DomainEvent } from '@guildmaster/game-protocol';
import type { ReactNode } from 'react';

type Props = {
  events: readonly DomainEvent[];
  diagnostics: ReactNode;
};

export function ActivityPanel({ events, diagnostics }: Props) {
  return <aside className="activity-rail" data-testid="activity-rail" aria-label="對局活動">
    <section className="log" aria-labelledby="event-log-title">
      <h2 id="event-log-title">事件紀錄</h2>
      {events.length === 0
        ? <p>等待你的第一個行動。</p>
        : events.slice(-12).reverse().map((item) => <p key={item.eventId}>{item.message}</p>)}
    </section>
    {diagnostics}
  </aside>;
}
