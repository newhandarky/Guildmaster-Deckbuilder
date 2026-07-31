import { forwardRef } from 'react';

type Props = {
  interactionHint: string;
  phaseName: string;
  canEndPhase: boolean;
  equipmentSelected: boolean;
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
    onEndPhase,
    onCancelEquipment,
    onRestart,
  },
  ref,
) {
  return <section className="turn-control-dock" data-testid="turn-control-dock" aria-labelledby="turn-controls-title">
    <div className="turn-control-copy">
      <h2 id="turn-controls-title">回合操作</h2>
      <p ref={ref} data-testid="interaction-hint" role="status" tabIndex={-1}>{interactionHint}</p>
    </div>
    <div className="controls">
      <button data-testid="end-phase" className="primary" type="button" disabled={!canEndPhase} onClick={onEndPhase}>
        結束{phaseName}階段
      </button>
      {equipmentSelected ? <button type="button" onClick={onCancelEquipment}>取消配戴</button> : null}
      <button type="button" onClick={onRestart}>重新開始</button>
    </div>
  </section>;
});
