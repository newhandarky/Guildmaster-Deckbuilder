import { useCallback, useEffect, useRef } from 'react';
import type { CardAction, CardVisualViewModel } from '../cards/card-visual-model.js';
import { CardIcon } from '../cards/card-icons.js';
import { ActionPreviewPanel } from './ActionPreviewPanel.js';
import { CardFace } from './Card.js';

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
  if (trigger) lastTriggerRef.current = trigger;
  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const lastTrigger = lastTriggerRef.current;
        const instanceId = lastTrigger?.dataset.cardInstanceId;
        const replacement = instanceId
          ? Array.from(document.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]')).find((element) => element.dataset.cardInstanceId === instanceId)
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

  const close = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
    restoreFocus();
  };

  const runAction = (action: CardAction) => {
    close();
    onAction(action);
  };

  return <dialog
    ref={dialogRef}
    className="card-details-dialog"
    aria-labelledby="card-details-title"
    onCancel={(event) => {
      event.preventDefault();
      close();
    }}
  >
    {card ? <article className="card-details" data-testid="card-details">
      <header className="card-details-header">
        <div>
          <p className="card-details-type">{card.cardTypeLabel}</p>
          <h2 id="card-details-title">{card.displayName}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="關閉卡牌詳情" onClick={close}>×</button>
      </header>
      <div className="card-details-body">
        <div
          className={`card game-card card-details-art card-${card.template}`}
          data-card-type={card.cardType}
          data-card-appearance={card.appearance}
          data-profession={card.profession}
        >
          <CardFace card={card} showState={false} sizes="(max-width: 767px) 112px, 252px" placeholderAccessible />
        </div>
        <p className="card-details-copy">{card.detailDisplayText}</p>
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
        {card.debugTags.length > 0 ? <details className="card-details-debug">
          <summary>開發者資訊</summary>
          <div className="card-debug-tags" aria-label="原始卡牌標籤">
            {card.debugTags.map((tag) => <code key={tag}>{tag}</code>)}
          </div>
        </details> : null}
      </div>
      <footer className="card-details-footer">
        {card.action ? <button className="primary" type="button" onClick={() => runAction(card.action!)}>{card.action.label}</button> : null}
        <button type="button" onClick={close}>關閉</button>
      </footer>
    </article> : null}
  </dialog>;
}
