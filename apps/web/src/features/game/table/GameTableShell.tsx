import { forwardRef, type ReactNode } from 'react';

type Props = {
  header: ReactNode;
  notices?: ReactNode;
  playerStatus: ReactNode;
  publicTable: ReactNode;
  party: ReactNode;
  hand: ReactNode;
  interaction: ReactNode;
  activity: ReactNode;
  details: ReactNode;
};

export const GameTableShell = forwardRef<HTMLElement, Props>(function GameTableShell(
  { header, notices, playerStatus, publicTable, party, hand, interaction, activity, details },
  ref,
) {
  return <main ref={ref} className="app-shell" data-testid="game-app" tabIndex={-1}>
    {header}
    {notices}
    {playerStatus}
    <div className="game-table-layout" data-testid="game-table-layout">
      <div className="game-play-column" data-testid="game-play-column">
        {publicTable}
        <div className="guild-area" data-testid="guild-area" role="region" aria-labelledby="guild-area-title">
          <h2 id="guild-area-title" className="area-title">你的公會區</h2>
          {party}
          {hand}
        </div>
        {interaction}
      </div>
      {activity}
    </div>
    {details}
  </main>;
});
