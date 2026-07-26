import type { CardDefinition, CardInstance, EnemyTargetState, SharedZones } from '@guildmaster/game-protocol';
import { Card } from '../../../ui/components/Card.js';

type Props = { zones: SharedZones; targets: Record<string, EnemyTargetState>; definitions: Readonly<Record<string, CardDefinition>>; cards: Record<string, CardInstance>; attackableTargetIds: ReadonlySet<string>; buyableCardIds: ReadonlySet<string>; onAttack: (targetId: string) => void; onBuy: (cardId: string) => void };

function definitionFor(cards: Props['cards'], definitions: Props['definitions'], cardId: string): CardDefinition | undefined { return definitions[cards[cardId]?.definitionId ?? '']; }

export function BoardPanel({ zones, targets, definitions, cards, attackableTargetIds, buyableCardIds, onAttack, onBuy }: Props) {
  const targetFor = (cardId: string) => Object.values(targets).find((target) => target.cardInstanceId === cardId && target.status === 'available');
  const renderRow = (title: string, ids: string[], action: 'attack' | 'buy') => <section><h2>{title}</h2><div className="card-row">{ids.map((id) => {
    const target = targetFor(id);
    const enabled = action === 'attack' ? Boolean(target && attackableTargetIds.has(target.targetId)) : buyableCardIds.has(id);
    return <Card key={id} instance={cards[id]} definition={definitionFor(cards, definitions, id)} onClick={enabled ? () => action === 'attack' && target ? onAttack(target.targetId) : onBuy(id) : undefined} />;
  })}</div></section>;
  return <div className="board-grid">
    {renderRow(`招募區（牌庫 ${zones.adventurerDeck.length}）`, zones.adventurerRow, 'buy')}
    {renderRow(`商店（牌庫 ${zones.itemDeck.length}）`, zones.itemRow, 'buy')}
    {renderRow(`魔物區（牌庫 ${zones.monsterDeck.length}）`, zones.monsterRow, 'attack')}
    {renderRow(`魔王（牌庫 ${zones.bossDeck.length}）`, zones.bossRow, 'attack')}
  </div>;
}
