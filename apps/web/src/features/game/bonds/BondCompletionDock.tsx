import { useEffect, useRef, useState } from 'react';
import type { BondDisplayDefinition } from './BondPanel.js';

type Props = {
  bondIds: readonly string[];
  definitions: readonly BondDisplayDefinition[];
  selectedBondIds: readonly string[];
  canComplete: boolean;
  onToggle: (bondId: string) => void;
  onComplete: () => void;
};

export function BondCompletionDock({
  bondIds,
  definitions,
  selectedBondIds,
  canComplete,
  onToggle,
  onComplete,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const availabilityKey = bondIds.join('|');

  useEffect(() => {
    setExpanded(true);
  }, [availabilityKey]);

  const collapse = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return <aside
    className="bond-completion-dock"
    data-testid="bond-completion-dock"
    aria-label="可完成羈絆"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && expanded) {
        event.preventDefault();
        collapse();
      }
    }}
  >
    <button
      ref={triggerRef}
      className="bond-completion-toggle"
      type="button"
      aria-expanded={expanded}
      aria-controls="bond-completion-content"
      onClick={() => {
        if (expanded) collapse();
        else {
          setExpanded(true);
          window.requestAnimationFrame(() => headingRef.current?.focus());
        }
      }}
    >
      <strong>{bondIds.length} 個羈絆可完成</strong>
      <span>{expanded ? '收合' : '展開處理'}</span>
    </button>

    <div id="bond-completion-content" className="bond-completion-content" hidden={!expanded}>
      <div>
        <p className="eyebrow">非阻擋提醒</p>
        <h2 ref={headingRef} id="bond-completion-heading" tabIndex={-1}>羈絆條件已成立</h2>
        <p>可以完成任意子集合，也可以稍後處理；暫不完成不會保存資格。</p>
      </div>
      <div className="bond-completion-options" role="group" aria-labelledby="bond-completion-heading">
        {bondIds.map((bondId) => {
          const bond = definitions.find(({ id }) => id === bondId);
          const checked = selectedBondIds.includes(bondId);
          return <label key={bondId}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(bondId)} />
            <span>{bond?.name ?? bondId} · {bond?.honor ?? 0} 榮譽</span>
          </label>;
        })}
      </div>
      <div className="controls bond-completion-actions">
        <button className="primary" type="button" disabled={!canComplete} onClick={onComplete}>完成所選羈絆</button>
        <button type="button" onClick={collapse}>稍後處理</button>
      </div>
    </div>
  </aside>;
}
