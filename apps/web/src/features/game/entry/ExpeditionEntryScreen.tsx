import { useEffect, useRef, useState } from 'react';
import type { SessionEntrySummary, SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { phaseDisplayName } from '../table/phase-copy.js';

type Props = {
  summary: SessionEntrySummary;
  persistence: SessionPersistenceStatus;
  onContinue: () => void;
  onStartNew: () => void;
};

const statusCopy: Record<SessionEntrySummary['status'], string> = {
  playing: '可繼續遊玩',
  finalRound: '最終輪進行中',
  pendingOfficialRuling: '等待規則裁定',
  finished: '對局已完成',
};

export function ExpeditionEntryScreen({ summary, persistence, onContinue, onStartNew }: Props) {
  const [confirmingNew, setConfirmingNew] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startNewRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirmingNew) return undefined;
    confirmRef.current?.focus();
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setConfirmingNew(false);
      window.requestAnimationFrame(() => startNewRef.current?.focus());
    };
    window.addEventListener('keydown', cancelWithEscape);
    return () => window.removeEventListener('keydown', cancelWithEscape);
  }, [confirmingNew]);

  const cancelNewExpedition = () => {
    setConfirmingNew(false);
    window.requestAnimationFrame(() => startNewRef.current?.focus());
  };

  return <main className="app-shell expedition-entry-shell" data-testid="expedition-entry">
    <header className="hero expedition-entry-hero">
      <div>
        <p className="eyebrow">原創文字示範牌組 · 單機人機對戰</p>
        <h1 ref={headingRef} tabIndex={-1}>{summary.canContinue ? '繼續晨星遠征' : '準備新的遠征'}</h1>
        <p>{summary.canContinue ? '已找到可恢復的本機進度。' : '使用目前的原創示範內容開始一局新對戰。'}</p>
      </div>
    </header>

    {persistence.state === 'memory-only'
      ? <aside className="warning" role="status" data-testid="entry-storage-warning">
          本機儲存目前不可用；仍可遊玩，但進度只會保留在此分頁。
        </aside>
      : null}

    <section className="expedition-entry-card" aria-labelledby="expedition-summary-heading">
      <div>
        <p className="eyebrow">遠征摘要</p>
        <h2 id="expedition-summary-heading">{summary.canContinue ? '最近進度' : '新對局'}</h2>
      </div>
      <dl className="expedition-summary" data-testid="expedition-summary">
        <div><dt>進度</dt><dd>第 {summary.round} 輪 · {phaseDisplayName(summary.phase)}階段</dd></div>
        <div><dt>狀態</dt><dd>{statusCopy[summary.status]}</dd></div>
        <div><dt>修訂</dt><dd>{summary.revision}</dd></div>
        <div><dt>Replay</dt><dd>{summary.replayHistoryComplete ? '完整紀錄' : '舊版存檔 · 紀錄不完整'}</dd></div>
      </dl>

      {confirmingNew
        ? <div className="expedition-new-confirmation" role="alertdialog" aria-labelledby="new-expedition-confirmation-heading" aria-describedby="new-expedition-confirmation-copy">
            <h3 id="new-expedition-confirmation-heading">確定開啟新遠征？</h3>
            <p id="new-expedition-confirmation-copy">目前的本機進度會被新的對局覆蓋，這個動作無法復原。</p>
            <div className="controls">
              <button ref={confirmRef} className="danger" type="button" onClick={onStartNew}>確認開啟新遠征</button>
              <button type="button" onClick={cancelNewExpedition}>保留目前進度</button>
            </div>
          </div>
        : <div className="controls expedition-entry-actions">
            {summary.canContinue
              ? <>
                  <button className="primary" type="button" onClick={onContinue}>繼續最近進度</button>
                  <button ref={startNewRef} type="button" onClick={() => setConfirmingNew(true)}>開啟新遠征</button>
                </>
              : <button className="primary" type="button" onClick={onStartNew}>開始新遠征</button>}
          </div>}
    </section>
  </main>;
}
