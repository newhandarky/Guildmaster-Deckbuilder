import type { ActionPreviewSet, CardDefinition, CardInstance, GameCommand, PublicEnemyTargetState, ZoneState } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';
import { actionPreviewItemsForScope, type ActionPreviewScope } from './action-preview-scope.js';
import { combatTargetStatusMessage } from './combat-target-status.js';
import { emptySupplyMessage } from './supply-empty-state.js';

type Props = {
  zones: Record<string, ZoneState>;
  targets: Record<string, PublicEnemyTargetState>;
  definitions: Readonly<Record<string, CardDefinition>>;
  cards: Record<string, CardInstance>;
  presentation: PresentationResolver;
  legalCommands: readonly GameCommand[];
  actionPreviews: ActionPreviewSet;
  previewScope: ActionPreviewScope;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
};

function definitionFor(cards: Props['cards'], definitions: Props['definitions'], cardId: string): CardDefinition | undefined {
  return definitions[cards[cardId]?.definitionId ?? ''];
}

export function BoardPanel({ zones, targets, definitions, cards, presentation, legalCommands, actionPreviews, previewScope, onInspect }: Props) {
  const cardsIn = (zoneId: string) => zones[zoneId]?.cardIds ?? [];
  const currentActionPreviews = actionPreviewItemsForScope(actionPreviews, previewScope);
  const availableTargets = new Map(
    Object.values(targets)
      .filter((target) => target.status === 'available')
      .map((target) => [target.cardInstanceId, target]),
  );
  const helperZone = zones['base:helper-active'];
  const helperCardId = helperZone?.cardIds[0];
  const helperDefinition = helperCardId ? definitionFor(cards, definitions, helperCardId) : undefined;
  const helperCard = helperCardId ? buildCardVisualModel({
    instance: cards[helperCardId],
    definition: helperDefinition,
    presentation: presentation.resolve(helperDefinition?.id ?? cards[helperCardId]?.definitionId ?? ''),
    interactionState: 'unavailable',
  }) : undefined;

  const renderRow = (zoneId: string, title: string, ids: readonly string[], action: 'attack' | 'buy') => {
    const emptyMessage = emptySupplyMessage(zoneId, ids.length);
    const headingId = `${zoneId.replaceAll(':', '-')}-title`;
    return <section className="board-row board-zone" data-zone-id={zoneId} aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <div className="card-row" aria-label={`${title}卡片`}>{ids.map((id) => {
        const target = availableTargets.get(id);
        const definition = definitionFor(cards, definitions, id);
        const command = action === 'attack'
          ? legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => candidate.type === 'ATTACK_TARGET' && candidate.targetId === target?.targetId)
          : legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD' && candidate.cardId === id);
        const cardAction = command
          ? commandAction(`${command.type}:${action === 'attack' ? target?.targetId : id}`, action === 'attack' ? '討伐' : definition?.type === 'adventurer' ? '招募' : '購買', command)
          : undefined;
        const actionPreview = command?.type === 'ATTACK_TARGET'
          ? currentActionPreviews.find((preview) => preview.kind === 'attack' && preview.targetId === command.targetId)
          : command?.type === 'BUY_CARD'
            ? currentActionPreviews.find((preview) => preview.kind === 'purchase' && preview.cardId === command.cardId)
            : undefined;
        const card = buildCardVisualModel({
          instance: cards[id],
          definition,
          presentation: presentation.resolve(definition?.id ?? cards[id]?.definitionId ?? ''),
          interactionState: cardAction ? 'legal' : 'unavailable',
          action: cardAction,
          actionPreview,
        });
        const targetStatus = action === 'attack' ? combatTargetStatusMessage(target) : undefined;
        return <div className="board-card-stack" key={id}>
          <Card card={card} onInspect={onInspect} />
          {targetStatus ? <p className="combat-target-status">{targetStatus}</p> : null}
        </div>;
      })}</div>
      {emptyMessage ? <p className="supply-empty-state">{emptyMessage}</p> : null}
    </section>;
  };

  return <section className="public-table-grid" data-testid="public-table" aria-label="公共牌桌">
    <section className="table-area encounter-area" data-testid="encounter-area" aria-labelledby="encounter-area-title">
      <h2 id="encounter-area-title" className="area-title">公共遭遇區</h2>
      <div className={`encounter-board-grid${helperZone ? ' encounter-board-grid-with-helper' : ''}`}>
        {helperZone ? <section className="board-row board-zone helper-panel" data-testid="helper-panel" data-zone-id="base:helper-active" aria-labelledby="helper-panel-title">
          <h3 id="helper-panel-title">目前協助者</h3>
          {helperCard
            ? <div className="card-row" aria-label="目前協助者卡片"><Card card={helperCard} onInspect={onInspect} /></div>
            : <p>目前沒有協助者在場。</p>}
          <p className="helper-retired-count">已離場 {cardsIn('base:helper-retired').length} 張</p>
        </section> : null}
        {renderRow('base:boss-row', `魔王（牌庫 ${cardsIn('base:boss-deck').length}）`, cardsIn('base:boss-row'), 'attack')}
        {renderRow('base:monster-row', `魔物區（牌庫 ${cardsIn('base:monster-deck').length}）`, cardsIn('base:monster-row'), 'attack')}
      </div>
    </section>
    <section className="table-area tavern-area" data-testid="tavern-area" aria-labelledby="tavern-area-title">
      <h2 id="tavern-area-title" className="area-title">酒館供應區</h2>
      <div className="tavern-supply-grid">
        {renderRow('base:adventurer-row', `招募區（牌庫 ${cardsIn('base:adventurer-deck').length}）`, cardsIn('base:adventurer-row'), 'buy')}
        {renderRow('base:item-row', `商店（牌庫 ${cardsIn('base:item-deck').length}）`, cardsIn('base:item-row'), 'buy')}
      </div>
    </section>
  </section>;
}
