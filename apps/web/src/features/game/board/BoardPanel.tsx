import type { CardDefinition, CardInstance, EnemyTargetState, GameCommand, ZoneState } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';

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
  const targetFor = (cardId: string) => Object.values(targets).find((target) => target.cardInstanceId === cardId && target.status === 'available');
  const renderRow = (title: string, ids: string[], action: 'attack' | 'buy') => <section><h2>{title}</h2><div className="card-row">{ids.map((id) => {
    const target = targetFor(id);
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
  })}</div></section>;
  return <div className="board-grid">
    {renderRow(`招募區（牌庫 ${cardsIn('base:adventurer-deck').length}）`, cardsIn('base:adventurer-row'), 'buy')}
    {renderRow(`商店（牌庫 ${cardsIn('base:item-deck').length}）`, cardsIn('base:item-row'), 'buy')}
    {renderRow(`魔物區（牌庫 ${cardsIn('base:monster-deck').length}）`, cardsIn('base:monster-row'), 'attack')}
    {renderRow(`魔王（牌庫 ${cardsIn('base:boss-deck').length}）`, cardsIn('base:boss-row'), 'attack')}
  </div>;
}
