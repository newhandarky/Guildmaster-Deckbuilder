import { describe, expect, it } from 'vitest';
import { emptySupplyMessage } from './supply-empty-state.js';

describe('base supply empty states', () => {
  it('shows approved copy only for empty adventurer and item rows', () => {
    expect(emptySupplyMessage('base:adventurer-row', 0)).toBe('目前沒有冒險者可以雇用');
    expect(emptySupplyMessage('base:item-row', 0)).toBe('目前沒有道具、裝備可以販售');
    expect(emptySupplyMessage('base:monster-row', 0)).toBeUndefined();
    expect(emptySupplyMessage('base:adventurer-row', 1)).toBeUndefined();
  });
});
