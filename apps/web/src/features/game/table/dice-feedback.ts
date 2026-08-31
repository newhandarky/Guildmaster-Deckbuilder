import type { DomainEvent } from '@guildmaster/game-protocol';

export function diceRewardText(event: DomainEvent, face: number): string | undefined {
  if (event.payload?.kind !== 'dice-roll') return undefined;
  return event.payload.evaluation.input.diceId === 'monster-02-reward-d6'
    ? `購買力 +${Math.ceil(face / 2)}`
    : undefined;
}
