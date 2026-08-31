import type { CardDefinition, CardInstance } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { buildCardVisualModel, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';
import { Card } from '../../../ui/components/Card.js';

type Props = {
  drawPileCount: number;
  discardPile: readonly string[];
  removedCardCount: number;
  cards: Readonly<Record<string, CardInstance>>;
  definitions: Readonly<Record<string, CardDefinition>>;
  presentation: PresentationResolver;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
};

export function PlayerZonesPanel({ drawPileCount, discardPile, removedCardCount, cards, definitions, presentation, onInspect }: Props) {
  const renderCards = (ids: readonly string[], empty: string) => ids.length
    ? <div className="card-row zone-inspector-cards">{ids.map((cardId) => {
        const instance = cards[cardId];
        const definition = definitions[instance?.definitionId ?? ''];
        const card = buildCardVisualModel({ instance, definition, presentation: presentation.resolve(definition?.id ?? instance?.definitionId ?? '') });
        return <Card key={cardId} card={card} onInspect={onInspect} />;
      })}</div>
    : <p>{empty}</p>;

  return <section className="player-zones-panel" aria-label="你的牌區">
    <section><h3>牌庫（{drawPileCount}）</h3><p>牌庫順序與卡面屬於隱藏資訊；規則要求查看或排序時，候選卡會在待處理互動中公開。</p></section>
    <section><h3>棄牌堆（{discardPile.length}）</h3>{renderCards(discardPile, '棄牌堆目前是空的。')}</section>
    <section><h3>移出遊戲（{removedCardCount}）</h3><p>{removedCardCount ? '為避免洩漏由隱藏牌庫直接移除的卡牌，本區只公開張數；從手牌、隊伍或棄牌堆移除時，待處理互動會先顯示卡名與去向。' : '目前沒有卡牌移出遊戲。'}</p></section>
  </section>;
}
