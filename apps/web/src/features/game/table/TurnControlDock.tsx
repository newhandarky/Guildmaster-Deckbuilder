import { forwardRef, type ReactNode } from 'react';

type Props = {
  interactionHint: string;
  actionSummary: string;
  phaseName: string;
  canEndPhase: boolean;
  equipmentSelected: boolean;
  purchaseBonus: number;
  combatBonus: number;
  latestEventStatus?: ReactNode;
  onEndPhase: () => void;
  onCancelEquipment: () => void;
};

export const TurnControlDock = forwardRef<HTMLParagraphElement, Props>(function TurnControlDock(
  {
    interactionHint,
    actionSummary,
    phaseName,
    canEndPhase,
    equipmentSelected,
    purchaseBonus,
    combatBonus,
    latestEventStatus,
    onEndPhase,
    onCancelEquipment,
  },
  ref,
) {
  return <section
    className="turn-control-dock"
    data-testid="turn-control-dock"
    aria-labelledby="turn-controls-title"
  >
    <div className="turn-vitals" aria-label="當前階段與數值">
      <strong>{phaseName}階段</strong>
      <span>購買 +{purchaseBonus}</span>
      <span>戰力 +{combatBonus}</span>
    </div>
    <div className="turn-control-copy">
      <h2 id="turn-controls-title" className="sr-only">回合操作</h2>
      <p
        ref={ref}
        id="interaction-hint"
        data-testid="interaction-hint"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
      >{interactionHint}</p>
      <p id="legal-action-summary" className="legal-action-summary" data-testid="legal-action-summary">{actionSummary}</p>
      {latestEventStatus}
    </div>
    <div className="controls">
      <button data-testid="end-phase" className="primary" type="button" disabled={!canEndPhase} aria-describedby="interaction-hint legal-action-summary" onClick={(event) => {
        if (event.detail > 1) return;
        onEndPhase();
      }}>
        結束{phaseName}階段
      </button>
      {equipmentSelected ? <button type="button" onClick={onCancelEquipment}>取消配戴</button> : null}
    </div>
  </section>;
});
