import { useEffect, useRef, useState } from 'react';
import type { CpuDifficulty } from '@guildmaster/game-protocol';
import type { SessionEntrySummary, SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { bossSetupBoundsForMode, formalCustomBossDeckSize, webContentModeOptions, webModeEffectSummary, type WebContentMode, type WebGameSetup } from '../../../app/ruleset.js';
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

type EntryView = 'menu' | 'setup';

const contentModeEntries = Object.entries(webContentModeOptions) as [
  WebContentMode,
  (typeof webContentModeOptions)[WebContentMode],
][];

const cpuDifficultyCopy: Record<CpuDifficulty, { label: string; description: string }> = {
  beginner: { label: '入門', description: '較寬容，適合第一次遊玩。' },
  standard: { label: '標準（建議）', description: '兼顧當回合收益與長期遠征規劃。' },
  challenge: { label: '挑戰', description: '積極準備魔王討伐並降低隊伍與裝備浪費。' },
};

export function CpuDifficultyPicker({ value, onChange }: { value: CpuDifficulty; onChange: (difficulty: CpuDifficulty) => void }) {
  return <fieldset className="advanced-rules-picker cpu-difficulty-picker">
    <legend>CPU 強度</legend>
    {(Object.entries(cpuDifficultyCopy) as [CpuDifficulty, (typeof cpuDifficultyCopy)[CpuDifficulty]][]).map(([difficulty, copy]) => <label key={difficulty} className={value === difficulty ? 'advanced-rule-option advanced-rule-option-selected' : 'advanced-rule-option'}>
      <input type="radio" name="cpu-difficulty" value={difficulty} checked={value === difficulty} onChange={() => onChange(difficulty)} />
      <span><strong>{copy.label}</strong><small>{copy.description}</small></span>
    </label>)}
  </fieldset>;
}

export function BossCountPicker({ value, maximum, onChange }: { value: number; maximum: number; onChange: (count: number) => void }) {
  return <fieldset className="advanced-rules-picker boss-count-picker">
    <legend>本局魔王數量</legend>
    <label htmlFor="boss-deck-size">增加本局需要面對的魔王</label>
    <select id="boss-deck-size" value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
      {Array.from({ length: maximum - formalCustomBossDeckSize + 1 }, (_, index) => formalCustomBossDeckSize + index).map((count) => <option key={count} value={count}>{count} 隻{count === formalCustomBossDeckSize ? '（正式規則）' : count === maximum ? '（全部魔王）' : ''}</option>)}
    </select>
    <div className="boss-count-summary" role="status"><span>正式規則：{formalCustomBossDeckSize} 隻</span><strong>本局：{value} 隻</strong></div>
    {value > formalCustomBossDeckSize ? <p className="content-mode-warning">自訂規則：對局時間與可取得總榮譽可能增加；完成 5 張羈絆仍可能提前進入最終輪。</p> : null}
    {value === maximum ? <p>本局使用全部魔王。</p> : null}
  </fieldset>;
}

const contentModePresentation: Readonly<Record<WebContentMode, {
  badge: string;
  description: string;
  numeral: string;
  tone: string;
}>> = {
  demo: { badge: '推薦入門', description: '適合第一次遊玩，使用完整可玩的原創牌組。', numeral: 'I', tone: 'emerald' },
  'provisional-playtest': { badge: '數值測試', description: '檢查起始卡與基礎數值的內部測試模式。', numeral: 'II', tone: 'amber' },
  'provisional-original-full': { badge: '完整規則', description: '完整基礎卡牌、羈絆與協助者規則。', numeral: 'III', tone: 'violet' },
  'custom-adventurers-full': { badge: '自定義角色', description: '以 40 張公開冒險者與 5 張起始角色替換基礎角色牌組。', numeral: 'IV', tone: 'rose' },
};

export function ExpeditionEntryScreen({ summary, persistence, onContinue, onStartNew }: Props) {
  const [entryView, setEntryView] = useState<EntryView>('menu');
  const [pendingSetup, setPendingSetup] = useState<WebGameSetup>();
  const [selectedMode, setSelectedMode] = useState<WebContentMode>(summary.contentMode);
  const [helpersEnabled, setHelpersEnabled] = useState(summary.advancedRules.helpers);
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>(summary.cpuDifficulty ?? 'standard');
  const [bossDeckSize, setBossDeckSize] = useState(summary.bossDeckSize ?? formalCustomBossDeckSize);
  const menuHeadingRef = useRef<HTMLHeadingElement>(null);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);
  const setupLaunchRef = useRef<HTMLButtonElement>(null);
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startNewRef = useRef<HTMLButtonElement>(null);
  const modePointerRef = useRef<{ pointerId: number; startY: number; dragged: boolean }>();
  const [showScrollHint, setShowScrollHint] = useState(false);

  useEffect(() => {
    if (entryView === 'menu') menuHeadingRef.current?.focus();
    else setupHeadingRef.current?.focus();
  }, [entryView]);

  useEffect(() => {
    const dialog = confirmationDialogRef.current;
    if (!dialog) return;
    if (pendingSetup && !dialog.open) {
      dialog.showModal();
      confirmRef.current?.focus();
    } else if (!pendingSetup && dialog.open) {
      dialog.close();
    }
  }, [pendingSetup]);

  useEffect(() => {
    if (entryView !== 'setup') {
      setShowScrollHint(false);
      return undefined;
    }
    const mobile = window.matchMedia('(max-width: 560px)');
    const update = () => setShowScrollHint(
      mobile.matches && document.documentElement.scrollHeight - window.scrollY - window.innerHeight > 32,
    );
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    mobile.addEventListener('change', update);
    const frame = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      mobile.removeEventListener('change', update);
    };
  }, [entryView, helpersEnabled, selectedMode]);

  const cancelNewExpedition = () => {
    setPendingSetup(undefined);
    window.requestAnimationFrame(() => startNewRef.current?.focus());
  };

  const openNewExpeditionSetup = () => {
    setPendingSetup(undefined);
    setEntryView('setup');
  };

  const returnToMainMenu = () => {
    setPendingSetup(undefined);
    setEntryView('menu');
    window.requestAnimationFrame(() => setupLaunchRef.current?.focus());
  };

  const startSelectedExpedition = () => {
    const setup: WebGameSetup = { schemaVersion: 1, contentMode: selectedMode, cpuDifficulty, advancedRules: { helpers: helpersEnabled }, ...(selectedMode === 'custom-adventurers-full' ? { customRules: { bossDeckSize } } : {}) };
    if (summary.canContinue) setPendingSetup(setup);
    else onStartNew(setup);
  };

  const selectedOption = webContentModeOptions[selectedMode];

  return <main className="app-shell expedition-entry-shell" data-testid="expedition-entry" data-entry-view={entryView}>
    <div className="expedition-entry-ambience" aria-hidden="true">
      <span className="expedition-entry-glow expedition-entry-glow-warm" />
      <span className="expedition-entry-glow expedition-entry-glow-magic" />
      <span className="expedition-entry-table-line" />
    </div>

    <div className="expedition-entry-stage">
      <section className="expedition-entry-brand" aria-label="Guildmaster Deckbuilder">
        <div className="guild-crest" aria-hidden="true"><span>GM</span></div>
        <p className="expedition-kicker">公會牌組構築遊戲</p>
        <p className="expedition-wordmark">Guildmaster</p>
        <p className="expedition-wordmark-subtitle">Deckbuilder</p>
        <p className="expedition-tagline">招募冒險者、締結羈絆，<br />寫下屬於你的公會傳說。</p>
      </section>

      <section className="expedition-entry-panel" aria-labelledby={entryView === 'menu' ? 'expedition-menu-heading' : 'expedition-setup-heading'}>
        {entryView === 'menu'
          ? <>
              <header className="expedition-menu-header">
                <p className="expedition-section-label">晨星公會 · 單機人機對戰</p>
                <h1 ref={menuHeadingRef} id="expedition-menu-heading" tabIndex={-1}>{summary.canContinue ? '繼續晨星遠征' : '準備新的遠征'}</h1>
                <p>{summary.canContinue ? '爐火仍亮著，你的隊伍正在等待下一道命令。' : '公會大門已經敞開，準備迎接第一批冒險者。'}</p>
              </header>

              <div className="entry-notice-stack">
                {persistence.recoveryReason
                  ? <aside className="warning" data-testid="entry-recovery-notice" role="status">舊進度未通過安全驗證，已建立新的遠征；原因：{persistence.recoveryReason}。</aside>
                  : null}
                {persistence.state === 'memory-only'
                  ? <aside className="warning" role="status" data-testid="entry-storage-warning">本機儲存目前不可用；仍可遊玩，但進度只會保留在此分頁。</aside>
                  : null}
                {persistence.recovery?.reasonCode === 'helper-rules-upgraded'
                  ? <aside className="warning" role="status" data-testid="helper-upgrade-recovery-notice">協助者規則已更新，舊進度無法安全續玩，已建立新遠征。</aside>
                  : null}
              </div>

              {summary.canContinue
                ? <article className="expedition-resume-card">
                    <div>
                      <p className="expedition-section-label">最近進度</p>
                      <h2>第 {summary.round} 輪 · {phaseDisplayName(summary.phase)}階段</h2>
                      <p>{webContentModeOptions[summary.contentMode].label}</p>
                      <p>CPU：{cpuDifficultyCopy[summary.cpuDifficulty ?? 'challenge'].label}{summary.bossDeckSize ? ` · 魔王 ${summary.bossDeckSize} 隻` : ''}</p>
                    </div>
                    <span className="expedition-status-seal">{statusCopy[summary.status]}</span>
                    <button className="entry-menu-button entry-menu-button-primary" type="button" onClick={onContinue}>
                      <span>繼續最近進度</span><span aria-hidden="true">→</span>
                    </button>
                  </article>
                : <div className="expedition-empty-state">
                    <span aria-hidden="true">✦</span>
                    <p>尚未建立遠征紀錄。選擇牌組內容後即可開始。</p>
                  </div>}

              <div className="expedition-main-actions">
                <button ref={setupLaunchRef} className={summary.canContinue ? 'entry-menu-button' : 'entry-menu-button entry-menu-button-primary'} type="button" onClick={openNewExpeditionSetup}>
                  <span>{summary.canContinue ? '開啟新遠征' : '開始新遠征'}</span><span aria-hidden="true">＋</span>
                </button>
              </div>

              <details className="expedition-technical-details">
                <summary>遠征詳細資訊</summary>
                <dl className="expedition-summary" data-testid="expedition-summary">
                  <div><dt>進度</dt><dd>第 {summary.round} 輪 · {phaseDisplayName(summary.phase)}階段</dd></div>
                  <div><dt>狀態</dt><dd>{statusCopy[summary.status]}</dd></div>
                  <div><dt>內容</dt><dd>{webContentModeOptions[summary.contentMode].label}</dd></div>
                  <div><dt>進階規則</dt><dd>{summary.advancedRules.helpers ? '協助者' : '未啟用'}</dd></div>
                  <div><dt>CPU 強度</dt><dd>{cpuDifficultyCopy[summary.cpuDifficulty ?? 'challenge'].label}</dd></div>
                  {summary.bossDeckSize ? <div><dt>本局魔王</dt><dd>{summary.bossDeckSize} 隻</dd></div> : null}
                  <div><dt>Replay</dt><dd>{summary.replayHistoryComplete ? '完整紀錄' : '舊版存檔 · 紀錄不完整'}</dd></div>
                  <div><dt>修訂</dt><dd>{summary.revision}</dd></div>
                </dl>
              </details>
            </>
          : <>
              <button className="expedition-back-button" type="button" onClick={returnToMainMenu}><span aria-hidden="true">←</span> 返回公會大廳</button>
              <header className="expedition-setup-header">
                <p className="expedition-section-label">建立新對局</p>
                <h2 ref={setupHeadingRef} id="expedition-setup-heading" tabIndex={-1}>選擇遠征內容</h2>
                <p>選擇這次使用的卡牌與規則組合。</p>
              </header>

              <fieldset className="content-mode-picker">
                <legend className="sr-only">新遠征內容</legend>
                {contentModeEntries.map(([mode, option]) => {
                  const presentation = contentModePresentation[mode];
                  const selected = selectedMode === mode;
                  return <label
                    key={mode}
                    className={selected ? 'content-mode-option content-mode-option-selected' : 'content-mode-option'}
                    data-tone={presentation.tone}
                    onPointerDown={(event) => {
                      if (event.pointerType === 'mouse') return;
                      modePointerRef.current = { pointerId: event.pointerId, startY: event.clientY, dragged: false };
                    }}
                    onPointerMove={(event) => {
                      const pointer = modePointerRef.current;
                      if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged) return;
                      if (Math.abs(event.clientY - pointer.startY) > 8) pointer.dragged = true;
                    }}
                    onPointerCancel={() => { modePointerRef.current = undefined; }}
                    onClickCapture={(event) => {
                      if (modePointerRef.current?.dragged) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                      modePointerRef.current = undefined;
                    }}
                  >
                    <input
                      type="radio"
                      name="content-mode"
                      value={mode}
                      checked={selected}
                      onChange={() => {
                        setSelectedMode(mode);
                        if (mode !== 'custom-adventurers-full') setBossDeckSize(formalCustomBossDeckSize);
                        if (mode !== 'provisional-playtest') setHelpersEnabled(mode === 'provisional-original-full' || mode === 'custom-adventurers-full');
                      }}
                    />
                    <span className="content-mode-numeral" aria-hidden="true">{presentation.numeral}</span>
                    <span className="content-mode-copy">
                      <span className="content-mode-heading"><strong>{option.label}</strong><small>{presentation.badge}</small></span>
                      <span>{presentation.description}</span>
                    </span>
                    <span className="content-mode-check" aria-hidden="true">✓</span>
                  </label>;
                })}
              </fieldset>

              <p className="content-mode-scroll-hint" data-visible={showScrollHint} aria-hidden="true">向下滑動查看更多</p>

              <div className="content-mode-detail" role="status">
                <div><span className="expedition-section-label">目前選擇</span><strong>{selectedOption.label}</strong></div>
                <p>{contentModePresentation[selectedMode].description}</p>
                {selectedOption.warning ? <p className="content-mode-warning">{selectedOption.warning}</p> : null}
              </div>

              <CpuDifficultyPicker value={cpuDifficulty} onChange={setCpuDifficulty} />

              {selectedMode === 'custom-adventurers-full' ? <BossCountPicker value={bossDeckSize} maximum={bossSetupBoundsForMode(selectedMode)!.maximum} onChange={setBossDeckSize} /> : null}

              {selectedMode === 'provisional-original-full' || selectedMode === 'custom-adventurers-full'
                ? <p className="notice expedition-rule-notice">完整四人模式固定啟用協助者規則。</p>
                : selectedMode === 'provisional-playtest'
                  ? <fieldset className="advanced-rules-picker">
                      <legend>進階規則</legend>
                      <label className={helpersEnabled ? 'advanced-rule-option advanced-rule-option-selected' : 'advanced-rule-option'}>
                        <input type="checkbox" checked={helpersEnabled} onChange={(event) => setHelpersEnabled(event.currentTarget.checked)} />
                        <span>
                          <strong>協助者進階規則</strong>
                          <small>依本局種子抽選協助者；目前已啟用 {webModeEffectSummary.helpers} 的效果。</small>
                        </span>
                      </label>
                    </fieldset>
                  : null}

              <div className="controls expedition-entry-actions">
                <button ref={startNewRef} className="primary" type="button" onClick={startSelectedExpedition}>開始新遠征</button>
                <button type="button" onClick={returnToMainMenu}>取消</button>
              </div>
            </>}
      </section>
    </div>

    <dialog
      ref={confirmationDialogRef}
      className="expedition-new-confirmation"
      aria-labelledby="new-expedition-confirmation-heading"
      aria-describedby="new-expedition-confirmation-copy"
      onCancel={(event) => {
        event.preventDefault();
        cancelNewExpedition();
      }}
    >
      {pendingSetup ? <>
        <h3 id="new-expedition-confirmation-heading">確定開啟新遠征？</h3>
        <p id="new-expedition-confirmation-copy">目前的本機進度會被「{webContentModeOptions[pendingSetup.contentMode].label} · CPU {cpuDifficultyCopy[pendingSetup.cpuDifficulty].label} · 協助者{pendingSetup.advancedRules.helpers ? '啟用' : '關閉'}{pendingSetup.customRules ? ` · 魔王 ${pendingSetup.customRules.bossDeckSize} 隻` : ''}」新對局覆蓋，這個動作無法復原。</p>
        <div className="controls">
          <button ref={confirmRef} className="danger" type="button" onClick={() => onStartNew(pendingSetup)}>確認開啟新遠征</button>
          <button type="button" onClick={cancelNewExpedition}>保留目前進度</button>
        </div>
      </> : null}
    </dialog>

    <footer className="expedition-entry-footer"><span>晨星公會</span><span aria-hidden="true">◆</span><span>四人離線遠征</span></footer>
  </main>;
}
