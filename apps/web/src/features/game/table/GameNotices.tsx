import type { EngineError, GameStatus } from '@guildmaster/game-protocol';

type Props = {
  status: GameStatus;
  error?: EngineError | undefined;
};

export function GameNotices({ status, error }: Props) {
  return <>
    {status === 'pendingOfficialRuling'
      ? <aside className="warning">目前啟用的 Rules Module 尚有必須先完成的規則裁定；本局已安全暫停。</aside>
      : null}
    {status === 'finalRound'
      ? <aside className="warning" data-testid="final-round-notice">最終輪已觸發；將完成目前輪次後結算。</aside>
      : null}
    {error ? <aside className="error">{error.code}：{error.message}</aside> : null}
  </>;
}
