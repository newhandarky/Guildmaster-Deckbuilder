import { useEffect, useRef, useState } from 'react';
import type { DomainEvent } from '@guildmaster/game-protocol';
import { diceRewardText } from './dice-feedback.js';

type Props = { event?: DomainEvent | undefined };

export function DiceResultToast({ event }: Props) {
  // The event present at mount belongs to history (including restored saves).
  const observedEventId = useRef(event?.eventId);
  const [visibleEvent, setVisibleEvent] = useState<DomainEvent>();
  const [displayFace, setDisplayFace] = useState(1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!event || event.type !== 'DIE_ROLLED' || event.payload?.kind !== 'dice-roll') return undefined;
    if (observedEventId.current !== event.eventId) {
      observedEventId.current = event.eventId;
      setSettled(false);
      setVisibleEvent(event);
    }
  }, [event]);

  useEffect(() => {
    if (visibleEvent?.payload?.kind !== 'dice-roll') return undefined;
    const finalFace = visibleEvent.payload.evaluation.face;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setSettled(reducedMotion);
    setDisplayFace(reducedMotion ? finalFace : 1);
    let step = 1;
    const interval = reducedMotion ? undefined : window.setInterval(() => {
      step = step % 6 + 1;
      setDisplayFace(step);
    }, 90);
    const settle = window.setTimeout(() => {
      if (interval !== undefined) window.clearInterval(interval);
      setDisplayFace(finalFace);
      setSettled(true);
    }, reducedMotion ? 0 : 810);
    const hide = window.setTimeout(() => setVisibleEvent(undefined), 4800);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      window.clearTimeout(settle);
      window.clearTimeout(hide);
    };
  }, [visibleEvent]);

  const finalFace = visibleEvent?.payload?.kind === 'dice-roll' ? visibleEvent.payload.evaluation.face : undefined;
  const reward = visibleEvent && finalFace !== undefined ? diceRewardText(visibleEvent, finalFace) : undefined;
  return <>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="dice-result-announcement">
      {visibleEvent && settled ? `擲骰結果：骰面 ${finalFace}${reward ? `，${reward}` : ''}。` : ''}
    </span>
    {visibleEvent ? <div className="dice-result-toast" data-settled={settled} data-testid="dice-result-toast" aria-hidden="true">
      <span className="dice-result-toast__label">{settled ? '擲骰結果' : '擲骰中'}</span>
      <strong className="dice-result-toast__face">{displayFace}</strong>
      {settled && reward ? <span>{reward}</span> : null}
    </div> : null}
  </>;
}
