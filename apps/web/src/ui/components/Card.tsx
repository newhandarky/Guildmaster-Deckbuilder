import type { MouseEvent } from 'react';
import type { CardMetric, CardVisualViewModel } from '../cards/card-visual-model.js';
import { CardPresentationImage } from './CardPresentationImage.js';

type Props = {
  card: CardVisualViewModel;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
  testId?: string;
};

export function CardArt({ card }: { card: CardVisualViewModel }) {
  return <span className="card-art" data-asset-key={card.art.key}>
    <CardPresentationImage art={card.art} sizes="(max-width: 767px) 112px, 146px" />
  </span>;
}

export function CardTitleScrim({ card }: { card: CardVisualViewModel }) {
  return <span className="card-title-scrim">
    <span className="card-type">{card.cardTypeLabel}</span>
    <strong>{card.displayName}</strong>
  </span>;
}

export function CardMetricRail({ metrics }: { metrics: readonly CardMetric[] }) {
  return <span className="card-metric-rail">
    {metrics.map((metric) => <span className={`card-metric card-metric-${metric.kind}`} key={metric.kind} aria-label={`${metric.label} ${metric.value}`}>
      <span aria-hidden="true">{metric.icon}</span>
      <strong>{metric.value}</strong>
    </span>)}
  </span>;
}

export function CardSummaryBand({ card }: { card: CardVisualViewModel }) {
  return <span className="card-summary-band">
    <span>{card.shortDisplayText}</span>
    {card.contextLabel ? <small>{card.contextLabel}</small> : null}
  </span>;
}

export function CardStateRing({ card }: { card: CardVisualViewModel }) {
  return <span className="card-state-label">
    <span className="card-state-marker" aria-hidden="true" />
    {card.stateLabel}
  </span>;
}

/** Inspectable presentation surface. Authoritative commands are executed only from CardDetailsPanel. */
export function Card({ card, onInspect, testId }: Props) {
  const inspect = (event: MouseEvent<HTMLButtonElement>) => onInspect(card, event.currentTarget);
  return <button
    type="button"
    data-testid={testId}
    data-card-instance-id={card.instanceId}
    data-card-type={card.cardType}
    data-card-template={card.template}
    data-card-state={card.interactionState}
    data-legal-action={card.action ? 'true' : 'false'}
    className={`card card-${card.template} card-state-${card.interactionState}`}
    aria-haspopup="dialog"
    aria-label={`${card.displayName}，${card.cardTypeLabel}，${card.stateDescription}，開啟卡牌詳情`}
    onClick={inspect}
  >
    <CardArt card={card} />
    <CardTitleScrim card={card} />
    <CardMetricRail metrics={card.metrics} />
    <CardSummaryBand card={card} />
    <CardStateRing card={card} />
  </button>;
}
