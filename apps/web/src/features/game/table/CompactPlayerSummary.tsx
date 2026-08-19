import type { PlayerView } from '@guildmaster/game-protocol';

type OpponentSummary = PlayerView['opponents'][number];

type Props = {
  opponent: OpponentSummary;
  expanded: boolean;
};

export function CompactPlayerSummary({ opponent, expanded }: Props) {
  const completedBonds = opponent.bonds.filter(({ completed }) => completed).length;
  return <span className="compact-player-summary">
    <strong className="compact-player-summary__name">{opponent.name}</strong>
    <small>{opponent.kind === 'ai' ? 'CPU' : '真人'}{opponent.isActive ? ' · 行動中' : ''}</small>
    <span className="compact-player-summary__metrics">
      <span>手牌 {opponent.handCount}</span>
      <span>隊伍 {opponent.partyCount}</span>
      <span>戰力 {opponent.partyCombat}</span>
      <span>羈絆 {completedBonds}/5</span>
    </span>
    <small className="compact-player-summary__hint">{expanded ? '公開資訊已展開' : '展開公開資訊'}</small>
  </span>;
}
