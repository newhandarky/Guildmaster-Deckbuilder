import type { CardDefinition, CardInstance, GameCommand } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import {
  buildCardVisualModel,
  cardActionMenu,
  commandAction,
  equipmentSelectionAction,
  type AttachableCommand,
  type CardVisualViewModel,
} from '../../../ui/cards/card-visual-model.js';

type Props = {
  cardIds: readonly string[];
  definitions: Readonly<Record<string, CardDefinition>>;
  cards: Readonly<Record<string, CardInstance>>;
  presentation: PresentationResolver;
  legalCommands: readonly GameCommand[];
  legalEquipCommands: readonly AttachableCommand[];
  equipmentCardId?: string | undefined;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
};

export function HandPanel({
  cardIds,
  definitions,
  cards,
  presentation,
  legalCommands,
  legalEquipCommands,
  equipmentCardId,
  onInspect,
}: Props) {
  return <section className="hand-panel" data-testid="hand" aria-labelledby="hand-title">
    <h3 id="hand-title">手牌</h3>
    <div className="card-row hand-card-row" data-motion-zone="self:hand" aria-label="手牌卡片">
      {cardIds.map((cardId) => {
        const instance = cards[cardId];
        const definition = definitions[instance?.definitionId ?? ''];
        const exactCommand = legalCommands.find(
          (command): command is Extract<GameCommand, { type: 'PLAY_ADVENTURER' | 'USE_ITEM' }> =>
            (command.type === 'PLAY_ADVENTURER' || command.type === 'USE_ITEM') && command.cardId === cardId,
        );
        const equipmentCommands = legalEquipCommands.filter((command) => command.cardId === cardId);
        const directAction = exactCommand
          ? commandAction(
            `${exactCommand.type}:${cardId}`,
            exactCommand.type === 'PLAY_ADVENTURER' ? '加入隊伍' : '使用道具',
            exactCommand,
          )
          : undefined;
        const rawAttachmentAction = equipmentSelectionAction(cardId, equipmentCommands);
        const attachmentAction = rawAttachmentAction ? {
          ...rawAttachmentAction,
          label: definition?.type === 'monster' || definition?.type === 'boss'
            ? '配戴給能收服敵人的隊員'
            : definition?.type === 'adventurer' ? '作為裝備配戴' : rawAttachmentAction.label,
        } : undefined;
        const action = cardActionMenu(`actions:${cardId}`, [
          ...(directAction ? [directAction] : []),
          ...(attachmentAction ? [attachmentAction] : []),
        ]);
        const card = buildCardVisualModel({
          instance,
          definition,
          presentation: presentation.resolve(definition?.id ?? instance?.definitionId ?? ''),
          interactionState: equipmentCardId === cardId ? 'selected' : action ? 'legal' : 'unavailable',
          action,
        });
        return <Card key={cardId} testId={`hand-card-${cardId}`} card={card} onInspect={onInspect} />;
      })}
    </div>
  </section>;
}
