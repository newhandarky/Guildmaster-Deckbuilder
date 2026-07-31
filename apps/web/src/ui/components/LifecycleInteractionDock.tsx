import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { GameCommand } from '@guildmaster/game-protocol';
import type { LifecycleInteractionAction, LifecycleInteractionModel } from '../lifecycle/lifecycle-interaction-model.js';

type Props = {
  model: LifecycleInteractionModel;
  scopeKey: string;
  onAction: (command: GameCommand) => void;
};

const hasActions = (
  model: LifecycleInteractionModel,
): model is Extract<LifecycleInteractionModel, { kind: 'choice' | 'counter-consent' }> =>
  model.kind === 'choice' || model.kind === 'counter-consent';

function actionStateKey(model: LifecycleInteractionModel): string {
  return hasActions(model) ? `${model.key}:${model.actions.map(({ id }) => id).join('|')}` : model.key;
}

function confirmationCopy(action: LifecycleInteractionAction): string {
  if (action.kind === 'decline') return '確認不同意後，本次公開請求會立即結束。';
  if (action.kind === 'cancel') return '確認取消後，本次公開請求會立即結束。';
  return '這會依規則立即結束等待，不會啟動或等待倒數計時。';
}

export const LifecycleInteractionDock = forwardRef<HTMLHeadingElement, Props>(function LifecycleInteractionDock(
  { model, scopeKey, onAction },
  headingRef,
) {
  const [confirmationId, setConfirmationId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const internalHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const stateKey = `${scopeKey}:${actionStateKey(model)}`;

  useImperativeHandle(headingRef, () => internalHeadingRef.current as HTMLHeadingElement);

  useEffect(() => {
    setConfirmationId(undefined);
    setSubmitting(false);
  }, [stateKey]);

  useEffect(() => {
    if (confirmationId) confirmButtonRef.current?.focus();
  }, [confirmationId]);

  if (model.kind === 'none') return null;
  const actions = hasActions(model) ? model.actions : [];
  const confirmation = actions.find(({ id }) => id === confirmationId);
  const run = (action: LifecycleInteractionAction) => {
    if (action.requiresConfirmation && confirmationId !== action.id) {
      setConfirmationId(action.id);
      return;
    }
    setSubmitting(true);
    onAction(action.command);
    window.requestAnimationFrame(() => setSubmitting(false));
  };

  return <aside
    className={`lifecycle-dock lifecycle-${model.kind}`}
    data-testid="lifecycle-dock"
    aria-labelledby="lifecycle-dock-title"
    aria-describedby="lifecycle-dock-description"
    aria-live="polite"
    aria-busy={submitting}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && confirmationId) {
        event.preventDefault();
        setConfirmationId(undefined);
      }
    }}
  >
    <div className="lifecycle-dock-copy">
      <p className="eyebrow">待處理規則互動</p>
      <h2 id="lifecycle-dock-title" ref={internalHeadingRef} tabIndex={-1}>{model.title}</h2>
      <p id="lifecycle-dock-description">{model.description}</p>
    </div>
    {'progress' in model && model.progress ? <ul className="lifecycle-progress" aria-label="回覆進度">
      {model.progress.map((actor) => <li key={actor.actorId} className={`progress-${actor.status}`}>
        <span aria-hidden="true">{actor.status === 'accepted' ? '✓' : '○'}</span>
        <span>{actor.name}</span>
        <small>{actor.status === 'accepted' ? '已同意' : '等待回覆'}</small>
      </li>)}
    </ul> : null}
    {model.kind === 'waiting' && model.reason === 'diagnostic'
      ? <p className="lifecycle-diagnostic" role="alert">已停止送出 lifecycle 指令，請保留目前對局並檢查診斷資訊。</p>
      : null}
    {model.kind === 'terminal-result'
      ? <output className={model.tone === 'success' ? 'lifecycle-result-success' : 'lifecycle-result-neutral'}>{model.reasonCode}</output>
      : null}
    {confirmation ? <div className="lifecycle-confirmation" role="group" aria-label={`確認${confirmation.label}`}>
      <p>{confirmationCopy(confirmation)}</p>
      <button ref={confirmButtonRef} className="danger" type="button" disabled={submitting} onClick={() => run(confirmation)}>確認{confirmation.label}</button>
      <button type="button" disabled={submitting} onClick={() => setConfirmationId(undefined)}>返回</button>
    </div> : actions.length > 0 ? <div className="lifecycle-actions">
      {actions.map((action) => <button
        key={action.id}
        className={action.emphasis === 'primary' ? 'primary' : action.emphasis === 'danger' ? 'danger' : undefined}
        type="button"
        disabled={submitting}
        onClick={() => run(action)}
      >{action.label}</button>)}
    </div> : null}
  </aside>;
});
