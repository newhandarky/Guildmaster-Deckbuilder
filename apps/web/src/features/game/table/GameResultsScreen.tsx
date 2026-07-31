import { forwardRef, type ReactNode } from 'react';

type ScoreboardRow = {
  playerId: string;
  rank: number;
  name: string;
  honor: number;
  defeatedBosses: number;
  defeatedMonsters: number;
};

type Props = {
  conditionId: string;
  scoreboard: readonly ScoreboardRow[];
  diagnostics: ReactNode;
  onRestart: () => void;
};

export const GameResultsScreen = forwardRef<HTMLElement, Props>(function GameResultsScreen(
  { conditionId, scoreboard, diagnostics, onRestart },
  ref,
) {
  return <main ref={ref} className="app-shell results-shell" data-testid="game-app" tabIndex={-1}>
    <section className="hero">
      <div>
        <p className="eyebrow">文字版 MVP</p>
        <h1>遠征結算</h1>
        <p>{conditionId}</p>
      </div>
    </section>
    <div className="results-layout">
      <section className="scoreboard">
        <h2>榮譽排名</h2>
        {scoreboard.map((row) => <div className="score-row" key={row.playerId}>
          <strong>#{row.rank} {row.name}</strong>
          <span>{row.honor} 榮譽</span>
          <small>魔王 {row.defeatedBosses}／魔物 {row.defeatedMonsters}</small>
        </div>)}
      </section>
      <aside className="activity-rail" aria-label="結算診斷">{diagnostics}</aside>
    </div>
    <button className="primary" type="button" onClick={onRestart}>開啟新遠征</button>
  </main>;
});
