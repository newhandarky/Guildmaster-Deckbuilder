import { forwardRef, type ReactNode } from 'react';

type Props = {
  header: ReactNode;
  notices?: ReactNode;
  playerStatus: ReactNode;
  publicTable: ReactNode;
  party: ReactNode;
  bondPanel: ReactNode;
  hand: ReactNode;
  interaction: ReactNode;
  utilities: ReactNode;
  details: ReactNode;
  motionFeedback?: ReactNode;
  motionBusy?: boolean;
  onSkipMotion?: () => void;
};

export const GameTableShell = forwardRef<HTMLElement, Props>(function GameTableShell(
  { header, notices, playerStatus, publicTable, party, bondPanel, hand, interaction, utilities, details, motionFeedback, motionBusy = false, onSkipMotion },
  ref,
) {
  return <main ref={ref} className="app-shell game-app-shell" data-testid="game-app" data-motion-busy={motionBusy} tabIndex={-1}>
    <a className="skip-link" href="#primary-game-table">跳到主要牌桌</a>
    {header}
    {notices}
    <div className="game-table-layout" data-testid="game-table-layout">
      {playerStatus}
      <div id="primary-game-table" className="game-play-column" data-testid="game-play-column" tabIndex={-1}>
        {publicTable}
        <div className="guild-area" data-testid="guild-area" data-motion-zone="self:play" role="region" aria-labelledby="guild-area-title">
          <h2 id="guild-area-title" className="area-title">你的公會區</h2>
          <div className="guild-party-column">{party}</div>
          {bondPanel}
          <div className="guild-hand-column">{hand}</div>
          <div className="table-command-area" data-testid="table-command-area">
            {interaction}
            {utilities}
          </div>
        </div>
      </div>
    </div>
      {motionBusy && onSkipMotion ? <button className="motion-skip-control" type="button" onClick={onSkipMotion}>略過動畫</button> : null}
      {details}
      {motionFeedback}
  </main>;
});
