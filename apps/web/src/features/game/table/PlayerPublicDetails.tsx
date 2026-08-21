import type { CardDefinition, CardInstance, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';

type OpponentSummary = PlayerView['opponents'][number];
type BondDefinition = { id: string; name: string; honor: number; conditionSummary: string };

type Props = {
  opponent: OpponentSummary;
  cards: Record<string, CardInstance>;
  definitions: Readonly<Record<string, CardDefinition>>;
  presentation: PresentationResolver;
  bondDefinitions: readonly BondDefinition[];
  onClose: () => void;
};

export function PlayerPublicDetails({ opponent, cards, definitions, presentation, bondDefinitions, onClose }: Props) {
  const nameFor = (cardId: string) => {
    const definitionId = cards[cardId]?.definitionId ?? '';
    return presentation.resolve(definitionId).displayName || definitions[definitionId]?.name || '公開卡牌';
  };
  const completedBonds = opponent.bonds.filter(({ completed }) => completed);

  return <aside
    id={`opponent-${opponent.id}`}
    className="opponent-details"
    data-testid="opponent-details"
    role="dialog"
    aria-label={`${opponent.name} 的公開資訊`}
  >
    <button type="button" className="icon-button opponent-details-close" aria-label={`關閉 ${opponent.name} 的公開資訊`} onClick={onClose}>×</button>
    <h2>{opponent.name} 的公開隊伍</h2>
    <p>已擊敗：魔王 {opponent.defeatedBosses} · 魔物 {opponent.defeatedMonsters}</p>
    <ol>{opponent.party.map((member) => {
      const attachments = member.equipmentIds ?? (member.equipmentId ? [member.equipmentId] : []);
      return <li key={member.adventurerId}><strong>{nameFor(member.adventurerId)}</strong> · 有效戰力 {member.effectiveCombat}{attachments.length ? ` · 附件：${attachments.map(nameFor).join('、')}` : ''}</li>;
    })}</ol>
    <p>已完成羈絆：{completedBonds.length ? completedBonds.map(({ bondId }) => {
      const bond = bondDefinitions.find(({ id }) => id === bondId);
      return `${bond?.name ?? bondId}（條件：${bond?.conditionSummary ?? '尚未提供條件摘要'}；${bond?.honor ?? 0} 榮譽）`;
    }).join('、') : '無'}</p>
    {opponent.counters.length ? <p>公開 counter：{opponent.counters.map(({ resourceId, amount }) => `${resourceId} ${amount}`).join('、')}</p> : null}
  </aside>;
}
