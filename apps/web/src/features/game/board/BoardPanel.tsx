import type { CardDefinition, CardInstance, EnemyTargetState, ZoneState } from '@guildmaster/game-protocol';
import { Card } from '../../../ui/components/Card.js';

type Props = { zones: Record<string, ZoneState>; targets: Record<string, EnemyTargetState>; definitions: Readonly<Record<string, CardDefinition>>; cards: Record<string, CardInstance>; attackableTargetIds: ReadonlySet<string>; buyableCardIds: ReadonlySet<string>; onAttack: (targetId: string) => void; onBuy: (cardId: string) => void };

function definitionFor(cards: Props['cards'], definitions: Props['definitions'], cardId: string): CardDefinition | undefined { return definitions[cards[cardId]?.definitionId ?? '']; }

export function BoardPanel({ zones, targets, definitions, cards, attackableTargetIds, buyableCardIds, onAttack, onBuy }: Props) {
  const cardsIn = (zoneId: string) => zones[zoneId]?.cardIds ?? [];
  const targetFor = (cardId: string) => Object.values(targets).find((target) => target.cardInstanceId === cardId && target.status === 'available');
  const renderRow = (title: string, ids: string[], action: 'attack' | 'buy') => <section><h2>{title}</h2><div className="card-row">{ids.map((id) => {
    const target = targetFor(id);
    const enabled = action === 'attack' ? Boolean(target && attackableTargetIds.has(target.targetId)) : buyableCardIds.has(id);
    return <Card key={id} instance={cards[id]} definition={definitionFor(cards, definitions, id)} onClick={enabled ? () => action === 'attack' && target ? onAttack(target.targetId) : onBuy(id) : undefined} />;
  })}</div></section>;
  return <div className="board-grid">
    {renderRow(`招募區（牌庫 ${cardsIn('base:adventurer-deck').length}）`, cardsIn('base:adventurer-row'), 'buy')}
    {renderRow(`商店（牌庫 ${cardsIn('base:item-deck').length}）`, cardsIn('base:item-row'), 'buy')}
    {renderRow(`魔物區（牌庫 ${cardsIn('base:monster-deck').length}）`, cardsIn('base:monster-row'), 'attack')}
    {renderRow(`魔王（牌庫 ${cardsIn('base:boss-deck').length}）`, cardsIn('base:boss-row'), 'attack')}
  </div>;
}
