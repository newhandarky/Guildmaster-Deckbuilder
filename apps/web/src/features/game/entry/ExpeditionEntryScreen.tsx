import { useEffect, useRef, useState } from 'react';
import type { SessionEntrySummary, SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { webContentModeOptions, type WebContentMode, type WebGameSetup } from '../../../app/ruleset.js';
import { phaseDisplayName } from '../table/phase-copy.js';

type Props = {
  summary: SessionEntrySummary;
  persistence: SessionPersistenceStatus;
  onContinue: () => void;
  onStartNew: (setup: WebGameSetup) => void;
};

const statusCopy: Record<SessionEntrySummary['status'], string> = {
  setup: '選擇私人羈絆',
  playing: '可繼續遊玩',
  finalRound: '最終輪進行中',
  pendingOfficialRuling: '等待規則裁定',
  finished: '對局已完成',
};

export function ExpeditionEntryScreen({ summary, persistence, onContinue, onStartNew }: Props) {
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [selectedMode, setSelectedMode] = useState<WebContentMode>(summary.contentMode);
  const [helpersEnabled, setHelpersEnabled] = useState(summary.advancedRules.helpers);
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
        <p className="eyebrow">{webContentModeOptions[summary.contentMode].label} · 單機人機對戰</p>
        <h1 ref={headingRef} tabIndex={-1}>{summary.canContinue ? '繼續晨星遠征' : '準備新的遠征'}</h1>
        <p>{summary.canContinue ? '已找到可恢復的本機進度。' : '選擇內容模式後開始一局新的單機對戰。'}</p>
      </div>
    </header>

    {persistence.recoveryReason
      ? <aside className="warning" data-testid="entry-recovery-notice" role="status">舊進度未通過安全驗證，已建立新的遠征；原因：{persistence.recoveryReason}。</aside>
      : null}

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
        <div><dt>內容</dt><dd>{webContentModeOptions[summary.contentMode].label}</dd></div>
        <div><dt>進階規則</dt><dd>{summary.advancedRules.helpers ? '協助者' : '未啟用'}</dd></div>
      </dl>

      <fieldset className="content-mode-picker">
        <legend>新遠征內容</legend>
        {(Object.entries(webContentModeOptions) as [WebContentMode, (typeof webContentModeOptions)[WebContentMode]][]).map(([mode, option]) => <label key={mode} className={selectedMode === mode ? 'content-mode-option content-mode-option-selected' : 'content-mode-option'}>
          <input
            type="radio"
            name="content-mode"
            value={mode}
            checked={selectedMode === mode}
            onChange={() => {
              setSelectedMode(mode);
              if (mode !== 'provisional-playtest') setHelpersEnabled(false);
            }}
          />
          <span><strong>{option.label}</strong><small>{option.description}</small>{option.warning ? <small className="content-mode-warning">{option.warning}</small> : null}</span>
        </label>)}
      </fieldset>

      {selectedMode === 'provisional-playtest'
        ? <fieldset className="advanced-rules-picker">
            <legend>進階規則</legend>
            <label className={helpersEnabled ? 'content-mode-option content-mode-option-selected' : 'content-mode-option'}>
              <input type="checkbox" checked={helpersEnabled} onChange={(event) => setHelpersEnabled(event.currentTarget.checked)} />
              <span>
                <strong>協助者進階規則</strong>
                <small>依本局種子抽選協助者；目前只有候選協助者 08 的隊伍上限效果已啟用。</small>
              </span>
            </label>
          </fieldset>
        : null}

      {confirmingNew
        ? <div className="expedition-new-confirmation" role="alertdialog" aria-labelledby="new-expedition-confirmation-heading" aria-describedby="new-expedition-confirmation-copy">
            <h3 id="new-expedition-confirmation-heading">確定開啟新遠征？</h3>
            <p id="new-expedition-confirmation-copy">目前的本機進度會被「{webContentModeOptions[selectedMode].label} · 協助者{helpersEnabled ? '啟用' : '關閉'}」新對局覆蓋，這個動作無法復原。</p>
            <div className="controls">
              <button ref={confirmRef} className="danger" type="button" onClick={() => onStartNew({ contentMode: selectedMode, advancedRules: { helpers: helpersEnabled } })}>確認開啟新遠征</button>
              <button type="button" onClick={cancelNewExpedition}>保留目前進度</button>
            </div>
          </div>
        : <div className="controls expedition-entry-actions">
            {summary.canContinue
              ? <>
                  <button className="primary" type="button" onClick={onContinue}>繼續最近進度</button>
                  <button ref={startNewRef} type="button" onClick={() => setConfirmingNew(true)}>開啟新遠征</button>
                </>
              : <button className="primary" type="button" onClick={() => onStartNew({ contentMode: selectedMode, advancedRules: { helpers: helpersEnabled } })}>開始新遠征</button>}
          </div>}
    </section>
  </main>;
}
