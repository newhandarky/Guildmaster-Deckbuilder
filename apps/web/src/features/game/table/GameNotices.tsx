import type { EngineError, GameStatus } from '@guildmaster/game-protocol';
import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';

type Props = {
  status: GameStatus;
  persistence: SessionPersistenceStatus;
  error?: EngineError | undefined;
};

export function GameNotices({ status, persistence, error }: Props) {
  return <>
    {persistence.state === 'restored'
      ? <aside className="notice" data-testid="restore-notice" role="status">
          {persistence.replayHistoryComplete
            ? '已恢復最近的本機進度。'
            : '已恢復舊版本機存檔；可以繼續遊玩，但此局沒有完整 Replay history。'}
        </aside>
      : null}
    {persistence.state === 'memory-only'
      ? <aside className="warning" data-testid="storage-warning" role="status">本機儲存目前不可用；最新進度只保留在此分頁，重新整理前請勿關閉。</aside>
      : null}
    {status === 'pendingOfficialRuling'
      ? <aside className="warning" role="status">目前啟用的 Rules Module 尚有必須先完成的規則裁定；本局已安全暫停。</aside>
      : null}
    {status === 'finalRound'
      ? <aside className="warning" data-testid="final-round-notice" role="status">最終輪已觸發；將完成目前輪次後結算。</aside>
      : null}
    {error ? <aside className="error" role="alert">{error.code}：{error.message}</aside> : null}
  </>;
}
