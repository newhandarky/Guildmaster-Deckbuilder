import type { ActionPreviewSet, CardDefinition, CardInstance, GameCommand, PublicEnemyTargetState, ZoneState } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, cardActionMenu, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';
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

function displayNameFor(cards: Props['cards'], definitions: Props['definitions'], presentation: PresentationResolver, cardId: string): string {
  const definition = definitionFor(cards, definitions, cardId);
  const resolved = presentation.resolve(definition?.id ?? cards[cardId]?.definitionId ?? '');
  return resolved.source === 'pack' ? resolved.displayName : definition?.name ?? resolved.displayName;
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
      <div className="card-row public-card-grid" aria-label={`${title}卡片`}>{ids.map((id) => {
        const target = availableTargets.get(id);
        const definition = definitionFor(cards, definitions, id);
        const attackCommands = action === 'attack'
          ? legalCommands.filter((candidate): candidate is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => candidate.type === 'ATTACK_TARGET' && candidate.targetId === target?.targetId)
          : [];
        const activationCommands = action === 'attack'
          ? legalCommands.filter((candidate): candidate is Extract<GameCommand, { type: 'ACTIVATE_CARD_EFFECT' }> => candidate.type === 'ACTIVATE_CARD_EFFECT' && candidate.targetId === target?.targetId)
          : [];
        const purchaseCommand = action === 'buy'
          ? legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD' && candidate.cardId === id)
          : undefined;
        const cardAction = action === 'attack'
          ? cardActionMenu(`target-actions:${target?.targetId}`, [
              ...activationCommands.map((command) => commandAction(
                `ACTIVATE_CARD_EFFECT:${command.cardId}:${command.targetId}`,
                `發動${displayNameFor(cards, definitions, presentation, command.cardId)}效果`,
                command,
              )),
              ...attackCommands.map((command) => commandAction(
                `ATTACK_TARGET:${command.targetId}:${command.combatAssistCardId ?? 'normal'}`,
                command.combatAssistCardId
                  ? `發動${displayNameFor(cards, definitions, presentation, command.combatAssistCardId)}效果並討伐`
                  : '討伐',
                command,
              )),
            ])
          : purchaseCommand
            ? commandAction(`BUY_CARD:${id}`, definition?.type === 'adventurer' ? '招募' : '購買', purchaseCommand)
            : undefined;
        const primaryCommand = attackCommands.length === 1 ? attackCommands[0] : purchaseCommand;
        const actionPreview = primaryCommand?.type === 'ATTACK_TARGET'
          ? currentActionPreviews.find((preview) => preview.kind === 'attack' && preview.command.targetId === primaryCommand.targetId && preview.command.combatAssistCardId === primaryCommand.combatAssistCardId)
          : primaryCommand?.type === 'BUY_CARD'
            ? currentActionPreviews.find((preview) => preview.kind === 'purchase' && preview.command.cardId === primaryCommand.cardId)
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
            ? <div className="card-row public-card-grid" aria-label="目前協助者卡片"><Card card={helperCard} onInspect={onInspect} /></div>
            : <p>目前沒有協助者在場。</p>}
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
