export function emptySupplyMessage(zoneId: string, cardCount: number): string | undefined {
  if (cardCount > 0) return undefined;
  if (zoneId === 'base:adventurer-row') return '目前沒有冒險者可以雇用';
  if (zoneId === 'base:item-row') return '目前沒有道具、裝備可以販售';
  return undefined;
}
