import type { EngineError, GameStatus } from '@guildmaster/game-protocol';
import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';

type Props = {
  status: GameStatus;
  persistence: SessionPersistenceStatus;
  contentMode: 'demo' | 'provisional-playtest' | 'provisional-original-full';
  helpersEnabled: boolean;
  error?: EngineError | undefined;
};

export function GameNotices({ status, persistence, contentMode, helpersEnabled, error }: Props) {
  return <>
    {contentMode === 'provisional-playtest'
      ? <aside className="warning" data-testid="provisional-content-warning" role="status">基礎候選數值測試模式：已接入首批物資與十項卡牌效果；其餘個別卡牌效果仍未啟用，此內容不代表正式卡表。{helpersEnabled ? '協助者 08 效果已啟用，其餘協助者僅測試輪替。' : ''}</aside>
      : null}
    {contentMode === 'provisional-original-full'
      ? <aside className="warning" data-testid="full-provisional-content-warning" role="status">基礎版原作衍生 Provisional 測試：完整候選 roster 使用非官方數位逐種類配比；未完成第二人覆核的效果保持停用，不代表官方完整卡表。</aside>
      : null}
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
