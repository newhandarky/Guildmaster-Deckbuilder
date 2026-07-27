import type { CardDefinition, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';

type Props = { player: PlayerView['self']; partyLimit: number; definitions: Readonly<Record<string, CardDefinition>>; cardDefinitions: Record<string, string>; presentation: PresentationResolver; onEquip: (adventurerId: string) => void; equipCardId?: string | undefined };

export function PartyPanel({ player, partyLimit, definitions, cardDefinitions, presentation, onEquip, equipCardId }: Props) {
  return <section><h2>隊伍（{player.party.length}/{partyLimit}）</h2><div className="card-row">
    {player.party.map((slot, index) => <div className="party-slot" key={slot.adventurerId}>
      <Card instance={{ id: slot.adventurerId, definitionId: cardDefinitions[slot.adventurerId] ?? '' }} definition={definitions[cardDefinitions[slot.adventurerId] ?? '']} presentation={presentation.resolve(cardDefinitions[slot.adventurerId] ?? '')} onClick={equipCardId ? () => onEquip(slot.adventurerId) : undefined} label={`位置 ${index + 1}`} />
      {slot.equipmentId ? <small>裝備：{presentation.resolve(cardDefinitions[slot.equipmentId] ?? '').displayName}</small> : <small>未配戴</small>}
    </div>)}
  </div></section>;
}
