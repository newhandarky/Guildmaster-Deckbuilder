import { useRef, useState } from 'react';
import type { PlayerView } from '@guildmaster/game-protocol';

type BondDefinition = { id: string; name: string; honor: number; requiredBosses: number };
type Props = { bonds: PlayerView['self']['bonds']; definitions: readonly BondDefinition[]; completableBondIds: readonly string[] };

export function BondPanel({ bonds, definitions, completableBondIds }: Props) {
  const [expanded, setExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const completedCount = bonds.filter(({ completed }) => completed).length;
  const close = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  return <section className="bond-panel" aria-labelledby="bond-panel-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      close();
    }
  }}>
    <button
      ref={buttonRef}
      id="bond-panel-title"
      className="bond-summary-toggle"
      type="button"
      aria-expanded={expanded}
      aria-controls="bond-panel-list"
      onClick={() => setExpanded((current) => !current)}
    ><strong>我的羈絆 {completedCount}/{bonds.length}</strong><span>{expanded ? '收合清單' : '查看清單'}</span></button>
    {expanded ? <ul id="bond-panel-list">{bonds.map(({ bondId, completed }) => {
      const bond = definitions.find(({ id }) => id === bondId);
      const state = completed ? '已完成' : completableBondIds.includes(bondId) ? '當下可完成' : '未完成';
      return <li key={bondId}><strong>{bond?.name ?? bondId}</strong><span>條件：擊敗 {bond?.requiredBosses ?? '?'} 名魔王</span><span>{bond?.honor ?? 0} 榮譽 · {state}</span></li>;
    })}</ul> : null}
  </section>;
}
