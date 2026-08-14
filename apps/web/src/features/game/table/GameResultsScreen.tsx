import { forwardRef, useEffect, useRef, type ReactNode } from 'react';
import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { SessionPersistenceLabel } from './SessionPersistenceLabel.js';

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
  viewerId: string;
  scoreboard: readonly ScoreboardRow[];
  diagnostics: ReactNode;
  notices: ReactNode;
  persistence: SessionPersistenceStatus;
  onRestart: () => void;
};

export const GameResultsScreen = forwardRef<HTMLElement, Props>(function GameResultsScreen(
  { conditionId, viewerId, scoreboard, diagnostics, notices, persistence, onRestart },
  ref,
) {
  const restartRef = useRef<HTMLButtonElement>(null);
  const viewer = scoreboard.find(({ playerId }) => playerId === viewerId);
  const sharedWinners = scoreboard.filter(({ rank }) => rank === 1).length > 1;
  const viewerOutcome = viewer?.rank === 1
    ? sharedWinners ? '共同勝利' : '勝利'
    : '失敗';

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => restartRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <main ref={ref} className="app-shell results-shell" data-testid="game-app" tabIndex={-1}>
    <section className="hero">
      <div>
        <p className="eyebrow">文字版 MVP</p>
        <h1>遠征結算</h1>
        <p>{conditionId}</p>
        <p data-testid="viewer-outcome"><strong>你的結果：{viewerOutcome}</strong>{viewer ? `（第 ${viewer.rank} 名）` : ''}</p>
      </div>
      <div className="status">
        <strong>對局已結束</strong>
        <SessionPersistenceLabel persistence={persistence} />
      </div>
    </section>
    {notices}
    <div className="results-layout">
      <section className="scoreboard" aria-labelledby="scoreboard-heading">
        <h2 id="scoreboard-heading">榮譽排名</h2>
        <ol className="scoreboard-list" aria-labelledby="scoreboard-heading">
        {scoreboard.map((row) => <li className="score-row" key={row.playerId}>
          <strong>#{row.rank} {row.name}</strong>
          <span>{row.honor} 榮譽</span>
          <small>魔王 {row.defeatedBosses}／魔物 {row.defeatedMonsters}</small>
        </li>)}
        </ol>
      </section>
      <aside className="activity-rail" aria-label="結算診斷">{diagnostics}</aside>
    </div>
    <button ref={restartRef} className="primary" type="button" onClick={onRestart}>開啟新遠征</button>
  </main>;
});
