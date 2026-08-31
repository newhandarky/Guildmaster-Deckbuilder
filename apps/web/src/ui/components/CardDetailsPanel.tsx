import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardAction, CardVisualViewModel } from '../cards/card-visual-model.js';
import { CardIcon } from '../cards/card-icons.js';
import { ActionPreviewPanel } from './ActionPreviewPanel.js';
import { CardPresentationImage } from './CardPresentationImage.js';

type Props = {
  card: CardVisualViewModel | undefined;
  trigger: HTMLButtonElement | undefined;
  getFocusFallback: () => HTMLElement | undefined;
  onClose: () => void;
  onAction: (action: CardAction) => void;
};

export function CardDetailsPanel({ card, trigger, getFocusFallback, onClose, onAction }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement>();
  const closingAnimationRef = useRef<Animation>();
  const closingGenerationRef = useRef(0);
  const [infoExpanded, setInfoExpanded] = useState(false);
  if (trigger) lastTriggerRef.current = trigger;
  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (dialogRef.current?.open) return;
        const lastTrigger = lastTriggerRef.current;
        const instanceId = lastTrigger?.dataset.cardInstanceId;
        const replacement = instanceId
          ? Array.from(document.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]')).find((element) => !element.closest('.motion-ghost-layer') && element.dataset.cardInstanceId === instanceId)
          : undefined;
        const focusTarget = lastTrigger?.isConnected ? lastTrigger : replacement ?? getFocusFallback();
        focusTarget?.focus();
      });
    });
  }, [getFocusFallback]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (card && !dialog.open) dialog.showModal();
    if (!card && dialog.open) {
      dialog.close();
      onClose();
      restoreFocus();
    }
  }, [card, onClose, restoreFocus]);

  useEffect(() => { setInfoExpanded(false); }, [card?.definitionId, card?.instanceId]);

  useEffect(() => () => {
    closingGenerationRef.current += 1;
    closingAnimationRef.current?.cancel();
    closingAnimationRef.current = undefined;
  }, [card]);

  const close = (immediate = false) => {
    const generation = ++closingGenerationRef.current;
    closingAnimationRef.current?.cancel();
    closingAnimationRef.current = undefined;
    const dialog = dialogRef.current;
    const complete = () => {
      if (generation !== closingGenerationRef.current) return;
      closingAnimationRef.current?.cancel();
      closingAnimationRef.current = undefined;
      if (dialog?.open) dialog.close();
      onClose();
      restoreFocus();
    };
    if (!dialog?.open || immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      complete();
      return;
    }
    const animation = dialog.querySelector<HTMLElement>('.card-details')?.animate(
      [{ opacity: 1, transform: 'translate3d(0, 0, 0)' }, { opacity: 0, transform: 'translate3d(0, .5rem, 0)' }],
      { duration: 180, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
    );
    if (!animation) complete();
    else {
      closingAnimationRef.current = animation;
      void animation.finished.then(complete, () => {});
    }
  };

  const runAction = (action: CardAction) => {
    close(true);
    onAction(action);
  };

  return <dialog
    ref={dialogRef}
    className="card-details-dialog"
    aria-labelledby="card-details-title"
    onCancel={(event) => {
      event.preventDefault();
      close(true);
    }}
  >
    {card ? <article className="card-details" data-testid="card-details">
      <div className="card-details-visual" data-testid="card-details-visual">
        <div className="card-details-art" data-asset-key={card.art.key}>
          <CardPresentationImage
            art={card.art}
            sizes="(max-width: 767px) 100vw, min(46vw, 480px)"
            placeholderAccessible
          />
        </div>
      </div>
      <div className="card-details-content" data-info-expanded={infoExpanded}>
        <header className="card-details-header">
          <div>
            <p className="card-details-type">{card.cardTypeLabel}</p>
            <h2 id="card-details-title">{card.displayName}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="關閉卡牌詳情" onClick={() => close()}>×</button>
        </header>
        <div className="card-details-sheet">
          <div className="card-details-summary">
            <div className="card-details-summary-metrics" aria-label="卡牌重要數值">
              {card.detailMetrics.map((metric) => <span key={metric.kind}><CardIcon iconKey={metric.iconKey} /> {metric.label} {metric.value}</span>)}
              {card.publicTags.map((tag) => <span key={tag.label}>{tag.iconKey ? <CardIcon iconKey={tag.iconKey} /> : null}{tag.label}</span>)}
              {card.detailMetrics.length === 0 && card.publicTags.length === 0 ? <span>{card.stateLabel}</span> : null}
            </div>
            <button
              type="button"
              className="card-details-info-toggle"
              aria-expanded={infoExpanded}
              aria-controls="card-details-information"
              onClick={() => setInfoExpanded((current) => !current)}
            >{infoExpanded ? '隱藏資訊' : '顯示資訊'}</button>
          </div>
          <div id="card-details-information" className="card-details-body">
            <p className="card-details-copy">{card.detailDisplayText}</p>
            {card.contextLabel ? <p className="card-details-context">{card.contextLabel}</p> : null}
            {card.detailMetrics.length > 0 ? <dl className="card-details-metrics">
              {card.detailMetrics.map((metric) => <div key={metric.kind}>
                <dt><CardIcon iconKey={metric.iconKey} /> {metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>)}
            </dl> : null}
            {card.actionPreview ? <ActionPreviewPanel preview={card.actionPreview} /> : null}
            <div className="card-details-meta">
              {card.publicTags.length > 0 ? <div className="card-tags" aria-label="卡牌標籤">
                {card.publicTags.map((tag) => <span key={tag.label} className={tag.tone ? `card-tag-${tag.tone}` : undefined}>{tag.iconKey ? <CardIcon iconKey={tag.iconKey} /> : null}{tag.label}</span>)}
              </div> : null}
              <p className={`card-details-state state-${card.interactionState}`}>{card.stateDescription}</p>
            </div>
          </div>
          <footer className="card-details-footer" data-has-action={Boolean(card.action)}>
            {card.action?.kind === 'action-menu'
              ? card.action.actions.map((action, index) => <button className={index === 0 ? 'primary' : undefined} key={action.id} type="button" onClick={() => runAction(action)}>{action.label}</button>)
              : card.action ? <button className="primary" type="button" onClick={() => runAction(card.action!)}>{card.action.label}</button> : null}
            <button type="button" className="card-details-desktop-close" onClick={() => close()}>關閉</button>
          </footer>
        </div>
      </div>
    </article> : null}
  </dialog>;
}
