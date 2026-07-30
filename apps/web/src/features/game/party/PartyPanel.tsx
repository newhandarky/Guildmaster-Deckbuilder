import type { CardDefinition, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';

type Props = {
  player: PlayerView['self'];
  partyLimit: number;
  definitions: Readonly<Record<string, CardDefinition>>;
  cardDefinitions: Record<string, string>;
  presentation: PresentationResolver;
  legalEquipCommands: readonly Extract<GameCommand, { type: 'EQUIP_ITEM' }>[];
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
  equipCardId?: string | undefined;
};

export function PartyPanel({ player, partyLimit, definitions, cardDefinitions, presentation, legalEquipCommands, onInspect, equipCardId }: Props) {
  return <section><h2>隊伍（{player.party.length}/{partyLimit}）</h2><div className="card-row">
    {player.party.map((slot, index) => {
      const definitionId = cardDefinitions[slot.adventurerId] ?? '';
      const command = equipCardId
        ? legalEquipCommands.find((candidate) => candidate.cardId === equipCardId && candidate.adventurerId === slot.adventurerId)
        : undefined;
      const action = command ? commandAction(`equip:${equipCardId}:${slot.adventurerId}`, '配戴至此隊員', command) : undefined;
      const card = buildCardVisualModel({
        instance: { id: slot.adventurerId, definitionId },
        definition: definitions[definitionId],
        presentation: presentation.resolve(definitionId),
        contextLabel: `位置 ${index + 1}`,
        interactionState: equipCardId ? action ? 'target' : 'unavailable' : 'default',
        action,
      });
      return <div className="party-slot" key={slot.adventurerId}>
        <Card card={card} onInspect={onInspect} />
        {slot.equipmentId ? <small>裝備：{presentation.resolve(cardDefinitions[slot.equipmentId] ?? '').displayName}</small> : <small>未配戴</small>}
      </div>;
    })}
  </div></section>;
}
