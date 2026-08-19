import type { MouseEvent } from 'react';
import { cardAccessibleName, type CardCornerSlot, type CardVisualViewModel } from '../cards/card-visual-model.js';
import { CardIcon } from '../cards/card-icons.js';
import { CardPresentationImage } from './CardPresentationImage.js';

type Props = {
  card: CardVisualViewModel;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
  testId?: string;
};

export function CardArt({
  card,
  sizes = '(max-width: 767px) 112px, 146px',
  placeholderAccessible = false,
}: {
  card: CardVisualViewModel;
  sizes?: string;
  placeholderAccessible?: boolean;
}) {
  return <span className="game-card__art" data-asset-key={card.art.key}>
    <CardPresentationImage art={card.art} sizes={sizes} placeholderAccessible={placeholderAccessible} />
  </span>;
}

export function CardCorner({ corner }: { corner: CardCornerSlot }) {
  return <span className={`game-card__corner game-card__corner--${corner.slot}`} role="img" aria-label={corner.accessibleLabel}>
    <CardIcon iconKey={corner.iconKey} />
    {corner.value !== undefined ? <strong aria-hidden="true">{corner.value}</strong> : null}
  </span>;
}

export function CardFace({
  card,
  showState = true,
  sizes = '(max-width: 767px) 112px, 146px',
  placeholderAccessible = false,
}: {
  card: CardVisualViewModel;
  showState?: boolean;
  sizes?: string;
  placeholderAccessible?: boolean;
}) {
  return <>
    <CardArt card={card} sizes={sizes} placeholderAccessible={placeholderAccessible} />
    <span className="game-card__wash" aria-hidden="true" />
    <span className="game-card__frame" aria-hidden="true" />
    <span className="game-card__nameplate"><strong>{card.displayName}</strong></span>
    {card.corners.map((corner) => <CardCorner corner={corner} key={corner.slot} />)}
    <span className="game-card__rules">
      <span className="game-card__skill-summary">{card.shortDisplayText}</span>
      {card.contextLabel ? <small>{card.contextLabel}</small> : null}
    </span>
    {showState ? <>
      <span className="game-card__state-ring" aria-hidden="true" />
      <span className="game-card__state-label"><span aria-hidden="true" />{card.stateLabel}</span>
    </> : null}
  </>;
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
    data-card-appearance={card.appearance}
    data-profession={card.profession}
    data-card-state={card.interactionState}
    data-legal-action={card.action ? 'true' : 'false'}
    className={`card game-card game-card-button card-${card.template}`}
    aria-haspopup="dialog"
    aria-label={cardAccessibleName(card)}
    onClick={inspect}
  >
    <CardFace card={card} />
  </button>;
}
