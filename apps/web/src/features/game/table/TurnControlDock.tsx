import { forwardRef, useEffect, useRef, useState } from 'react';

type Props = {
  interactionHint: string;
  phaseName: string;
  canEndPhase: boolean;
  equipmentSelected: boolean;
  scopeKey: string;
  onEndPhase: () => void;
  onCancelEquipment: () => void;
  onRestart: () => void;
};

export const TurnControlDock = forwardRef<HTMLParagraphElement, Props>(function TurnControlDock(
  {
    interactionHint,
    phaseName,
    canEndPhase,
    equipmentSelected,
    scopeKey,
    onEndPhase,
    onCancelEquipment,
    onRestart,
  },
  ref,
) {
  const [restartConfirmation, setRestartConfirmation] = useState(false);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRestartRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setRestartConfirmation(false);
  }, [scopeKey]);

  useEffect(() => {
    if (restartConfirmation) confirmRestartRef.current?.focus();
  }, [restartConfirmation]);

  const cancelRestart = () => {
    setRestartConfirmation(false);
    window.requestAnimationFrame(() => restartButtonRef.current?.focus());
  };

  return <section
    className="turn-control-dock"
    data-testid="turn-control-dock"
    aria-labelledby="turn-controls-title"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && restartConfirmation) {
        event.preventDefault();
        cancelRestart();
      }
    }}
  >
    <div className="turn-control-copy">
      <h2 id="turn-controls-title">回合操作</h2>
      <p
        ref={ref}
        id="interaction-hint"
        data-testid="interaction-hint"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
      >{interactionHint}</p>
    </div>
    {restartConfirmation ? <div className="controls restart-confirmation" role="group" aria-label="確認重新開始">
      <p>重新開始會放棄目前尚未完成的對局。</p>
      <button ref={confirmRestartRef} className="danger" type="button" onClick={() => {
        setRestartConfirmation(false);
        onRestart();
      }}>確認重新開始</button>
      <button type="button" onClick={cancelRestart}>繼續目前對局</button>
    </div> : <div className="controls">
      <button data-testid="end-phase" className="primary" type="button" disabled={!canEndPhase} aria-describedby="interaction-hint" onClick={onEndPhase}>
        結束{phaseName}階段
      </button>
      {equipmentSelected ? <button type="button" onClick={onCancelEquipment}>取消配戴</button> : null}
      <button ref={restartButtonRef} type="button" onClick={() => setRestartConfirmation(true)}>重新開始</button>
    </div>}
  </section>;
});
