import type { CardDefinition, GameCommand, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type AttachableCommand, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';

type Props = {
  player: PlayerView['self'];
  partyLimit: number;
  definitions: Readonly<Record<string, CardDefinition>>;
  cardDefinitions: Record<string, string>;
  presentation: PresentationResolver;
  legalEquipCommands: readonly AttachableCommand[];
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
  onCommand: (command: GameCommand) => void;
  equipCardId?: string | undefined;
};

export function PartyPanel({ player, partyLimit, definitions, cardDefinitions, presentation, legalEquipCommands, onInspect, onCommand, equipCardId }: Props) {
  return <section className="party-panel" aria-labelledby="party-title">
    <h3 id="party-title">隊伍（{player.party.length}/{partyLimit}）</h3>
    <div className="card-row" aria-label="隊伍卡片">
    {player.party.map((slot, index) => {
      const definitionId = cardDefinitions[slot.adventurerId] ?? '';
      const commands = equipCardId
        ? legalEquipCommands.filter((candidate) => candidate.cardId === equipCardId && candidate.adventurerId === slot.adventurerId)
        : [];
      const command = commands.length === 1 ? commands[0] : undefined;
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
        {(slot.equipmentIds ?? (slot.equipmentId ? [slot.equipmentId] : [])).length
          ? <small>附件：{(slot.equipmentIds ?? [slot.equipmentId!]).map((id) => presentation.resolve(cardDefinitions[id] ?? '').displayName).join('、')}</small>
          : <small>未配戴</small>}
        {commands.length > 1 ? <div className="party-slot__attachment-choices" aria-label="選擇要替換的附件">
          {commands.map((candidate) => <button key={JSON.stringify(candidate)} type="button" onClick={() => onCommand(candidate)}>替換 {candidate.type === 'ATTACH_CARD' && candidate.replaceCardId ? presentation.resolve(cardDefinitions[candidate.replaceCardId] ?? '').displayName : '附件'}</button>)}
        </div> : null}
      </div>;
    })}
    </div>
  </section>;
}
