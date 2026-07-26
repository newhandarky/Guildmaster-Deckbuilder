import type { GameState } from '@guildmaster/game-protocol';

export function nextRandom(state: GameState): number {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 0x1_0000_0000;
}

export function shuffle<T>(state: GameState, values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(nextRandom(state) * (index + 1));
    const current = result[index];
    result[index] = result[nextIndex]!;
    result[nextIndex] = current!;
  }
  return result;
}
