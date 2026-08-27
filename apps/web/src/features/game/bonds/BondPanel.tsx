import { useRef, useState } from 'react';
import type { PlayerView } from '@guildmaster/game-protocol';

export type BondDisplayDefinition = { id: string; name: string; honor: number; conditionSummary: string; detailDescription: string };
type Props = { bonds: PlayerView['self']['bonds']; evaluations: PlayerView['bondEvaluations']; definitions: readonly BondDisplayDefinition[]; completableBondIds: readonly string[] };

export function BondPanel({ bonds, evaluations, definitions, completableBondIds }: Props) {
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
    <ul id="bond-panel-list" hidden={!expanded} tabIndex={expanded ? 0 : -1} aria-label="我的羈絆條件清單">{bonds.map(({ bondId, completed }) => {
      const bond = definitions.find(({ id }) => id === bondId);
      const state = completed ? '已完成' : completableBondIds.includes(bondId) ? '當下可完成' : '未完成';
      const evaluation = evaluations.find((candidate) => candidate.bondId === bondId);
      return <li key={bondId} data-bond-satisfied={evaluation?.satisfied ? 'true' : 'false'}><strong>{bond?.name ?? bondId}</strong><span>條件：{bond?.conditionSummary ?? '尚未提供條件摘要'}</span><span>{bond?.honor ?? 0} 榮譽 · {state}</span></li>;
    })}</ul>
  </section>;
}
