import type { CardDefinition, CardInstance, EnemyTargetState, GameCommand, ZoneState } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';
import { emptySupplyMessage } from './supply-empty-state.js';

type Props = {
  zones: Record<string, ZoneState>;
  targets: Record<string, EnemyTargetState>;
  definitions: Readonly<Record<string, CardDefinition>>;
  cards: Record<string, CardInstance>;
  presentation: PresentationResolver;
  legalCommands: readonly GameCommand[];
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
};

function definitionFor(cards: Props['cards'], definitions: Props['definitions'], cardId: string): CardDefinition | undefined { return definitions[cards[cardId]?.definitionId ?? '']; }

export function BoardPanel({ zones, targets, definitions, cards, presentation, legalCommands, onInspect }: Props) {
  const cardsIn = (zoneId: string) => zones[zoneId]?.cardIds ?? [];
  const availableTargets = new Map(
    Object.values(targets)
      .filter((target) => target.status === 'available')
      .map((target) => [target.cardInstanceId, target]),
  );
  const renderRow = (zoneId: string, title: string, ids: readonly string[], action: 'attack' | 'buy') => {
    const emptyMessage = emptySupplyMessage(zoneId, ids.length);
    return <section className="board-row" data-zone-id={zoneId}>
      <h3>{title}</h3>
      <div className="card-row" aria-label={`${title}卡片`}>{ids.map((id) => {
      const target = availableTargets.get(id);
      const definition = definitionFor(cards, definitions, id);
      const command = action === 'attack'
        ? legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => candidate.type === 'ATTACK_TARGET' && candidate.targetId === target?.targetId)
        : legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD' && candidate.cardId === id);
      const cardAction = command
        ? commandAction(`${command.type}:${action === 'attack' ? target?.targetId : id}`, action === 'attack' ? '討伐' : definition?.type === 'adventurer' ? '招募' : '購買', command)
        : undefined;
      const card = buildCardVisualModel({
        instance: cards[id],
        definition,
        presentation: presentation.resolve(definition?.id ?? cards[id]?.definitionId ?? ''),
        interactionState: cardAction ? 'legal' : 'unavailable',
        action: cardAction,
      });
      return <Card key={id} card={card} onInspect={onInspect} />;
    })}</div>
      {emptyMessage ? <p className="supply-empty-state">{emptyMessage}</p> : null}
    </section>;
  };
  return <div className="public-table-grid" data-testid="public-table">
    <div className="table-area encounter-area" data-testid="encounter-area" role="region" aria-labelledby="encounter-area-title">
      <h2 id="encounter-area-title" className="area-title">公共遭遇區</h2>
      {renderRow('base:boss-row', `魔王（牌庫 ${cardsIn('base:boss-deck').length}）`, cardsIn('base:boss-row'), 'attack')}
      {renderRow('base:monster-row', `魔物區（牌庫 ${cardsIn('base:monster-deck').length}）`, cardsIn('base:monster-row'), 'attack')}
    </div>
    <div className="table-area tavern-area" data-testid="tavern-area" role="region" aria-labelledby="tavern-area-title">
      <h2 id="tavern-area-title" className="area-title">酒館供應區</h2>
      {renderRow('base:adventurer-row', `招募區（牌庫 ${cardsIn('base:adventurer-deck').length}）`, cardsIn('base:adventurer-row'), 'buy')}
      {renderRow('base:item-row', `商店（牌庫 ${cardsIn('base:item-deck').length}）`, cardsIn('base:item-row'), 'buy')}
    </div>
  </div>;
}
