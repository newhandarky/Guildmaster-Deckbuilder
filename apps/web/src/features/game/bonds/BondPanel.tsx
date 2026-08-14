import type { PlayerView } from '@guildmaster/game-protocol';

type BondDefinition = { id: string; name: string; honor: number; requiredBosses: number };
type Props = { bonds: PlayerView['self']['bonds']; definitions: readonly BondDefinition[]; completableBondIds: readonly string[] };

export function BondPanel({ bonds, definitions, completableBondIds }: Props) {
  return <section className="bond-panel" aria-labelledby="bond-panel-title">
    <h3 id="bond-panel-title">我的羈絆</h3>
    <ul>{bonds.map(({ bondId, completed }) => {
      const bond = definitions.find(({ id }) => id === bondId);
      const state = completed ? '已完成' : completableBondIds.includes(bondId) ? '當下可完成' : '未完成';
      return <li key={bondId}><strong>{bond?.name ?? bondId}</strong><span>條件：擊敗 {bond?.requiredBosses ?? '?'} 名魔王</span><span>{bond?.honor ?? 0} 榮譽 · {state}</span></li>;
    })}</ul>
  </section>;
}
