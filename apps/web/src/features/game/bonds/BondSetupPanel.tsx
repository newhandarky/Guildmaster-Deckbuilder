import { forwardRef, useEffect, useRef } from 'react';
import type { BondDisplayDefinition } from './BondPanel.js';

type Props = {
  bonds: readonly BondDisplayDefinition[];
  selectedBondIds: readonly string[];
  onToggle: (bondId: string) => void;
  onConfirm: () => void;
};

const requiredBondCount = 5;

export const BondSetupPanel = forwardRef<HTMLHeadingElement, Props>(function BondSetupPanel({ bonds, selectedBondIds, onToggle, onConfirm }, headingRef) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectionComplete = selectedBondIds.length === requiredBondCount;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return <dialog
    ref={dialogRef}
    className="bond-setup-panel blocking-choice-panel"
    aria-labelledby="bond-setup-heading"
    aria-describedby="bond-setup-instructions"
    onCancel={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }}
  >
    <header className="bond-setup-header">
      <div>
        <p className="eyebrow">私人目標</p>
        <h2 ref={headingRef} id="bond-setup-heading" tabIndex={-1}>從七張私人羈絆保留五張</h2>
        <p id="bond-setup-instructions">比較每張羈絆的完成條件與榮譽，勾選本局要保留的五張。</p>
      </div>
      <p className="bond-selection-count" aria-live="polite" data-complete={selectionComplete ? 'true' : 'false'}>
        已選 <strong>{selectedBondIds.length}</strong> / {requiredBondCount}
      </p>
    </header>

    <div className="bond-choice-grid" role="group" aria-label="候選羈絆">
      {bonds.map((bond) => {
        const checked = selectedBondIds.includes(bond.id);
        const unavailable = !checked && selectionComplete;
        const descriptionId = `bond-choice-${bond.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-condition`;
        return <article key={bond.id} className="bond-choice-card" data-selected={checked ? 'true' : 'false'}>
          <label className="bond-choice-select">
            <input
              type="checkbox"
              checked={checked}
              disabled={unavailable}
              aria-describedby={descriptionId}
              onChange={() => onToggle(bond.id)}
            />
            <span className="bond-choice-title">
              <strong>{bond.name}</strong>
              <small>{checked ? '已選取' : unavailable ? '已選滿五張' : '勾選保留'}</small>
            </span>
            <span className="bond-choice-honor"><strong>{bond.honor}</strong> 榮譽</span>
          </label>
          <div className="bond-choice-effect" id={descriptionId}>
            <span>完成條件</span>
            <p>{bond.conditionSummary}</p>
          </div>
          <details className="bond-choice-details">
            <summary>查看完整規則說明</summary>
            <p>{bond.detailDescription}</p>
          </details>
        </article>;
      })}
    </div>

    <footer className="bond-setup-actions">
      <p>{selectionComplete ? '已選好五張，可以開始遠征。' : `還需要選擇 ${requiredBondCount - selectedBondIds.length} 張。`}</p>
      <button className="primary" type="button" disabled={!selectionComplete} onClick={onConfirm}>確認保留五張</button>
    </footer>
  </dialog>;
});
