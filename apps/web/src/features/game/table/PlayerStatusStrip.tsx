import type { Phase, PlayerView } from '@guildmaster/game-protocol';

type OpponentSummary = Pick<
  PlayerView['opponents'][number],
  'id' | 'name' | 'handCount' | 'partyCount' | 'discardCount'
>;

type SelfSummary = {
  handCount: number;
  drawPileCount: number;
  discardCount: number;
  turnPurchaseBonus: number;
  turnCombatBonus: number;
};

type Props = {
  self: SelfSummary;
  phase: Phase;
  opponents: readonly OpponentSummary[];
};

export function PlayerStatusStrip({ self, phase, opponents }: Props) {
  return <section className="player-summary" data-testid="player-summary" aria-labelledby="player-status-title">
    <div>
      <h2 id="player-status-title">你的公會</h2>
      <span data-testid="human-card-count">手牌 {self.handCount} · 牌庫 {self.drawPileCount} · 棄牌 {self.discardCount}</span>
    </div>
    <div>
      <strong data-testid="phase-status">{phase === 'purchase' ? '購買階段' : '準備行動'}</strong>
      <span>道具加成：購買 +{self.turnPurchaseBonus}／戰力 +{self.turnCombatBonus}</span>
    </div>
    {opponents.map((opponent) => <div key={opponent.id}>
      <h2>{opponent.name}</h2>
      <span>手牌 {opponent.handCount} · 隊伍 {opponent.partyCount} · 棄牌 {opponent.discardCount}</span>
    </div>)}
  </section>;
}
