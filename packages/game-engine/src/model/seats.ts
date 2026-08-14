import type { PlayerState } from '@guildmaster/game-protocol';

type SeatPlayer = Pick<PlayerState, 'id'>;

function seatIndex(players: readonly SeatPlayer[], playerId: string): number {
  const index = players.findIndex(({ id }) => id === playerId);
  if (index < 0) throw new Error(`Unknown seat player: ${playerId}.`);
  return index;
}

export function nextSeat<T extends SeatPlayer>(players: readonly T[], playerId: string): T {
  if (!players.length) throw new Error('Seat order cannot be empty.');
  return players[(seatIndex(players, playerId) + 1) % players.length]!;
}

export function previousSeat<T extends SeatPlayer>(players: readonly T[], playerId: string): T {
  if (!players.length) throw new Error('Seat order cannot be empty.');
  return players[(seatIndex(players, playerId) - 1 + players.length) % players.length]!;
}

export function seatOrderFrom<T extends SeatPlayer>(players: readonly T[], playerId: string): readonly T[] {
  const start = seatIndex(players, playerId);
  return Array.from({ length: players.length }, (_, offset) => players[(start + offset) % players.length]!);
}
