import { describe, expect, it } from 'vitest';
import type { ActionPreviewSet } from '@guildmaster/game-protocol';
import { actionPreviewItemsForScope } from './action-preview-scope.js';
import { hasUnviewedCardIds } from './public-table-tab-state.js';
import { emptySupplyMessage } from './supply-empty-state.js';

describe('base supply empty states', () => {
  it('shows approved copy only for empty adventurer and item rows', () => {
    expect(emptySupplyMessage('base:adventurer-row', 0)).toBe('目前沒有冒險者可以雇用');
    expect(emptySupplyMessage('base:item-row', 0)).toBe('目前沒有道具、裝備可以販售');
    expect(emptySupplyMessage('base:monster-row', 0)).toBeUndefined();
    expect(emptySupplyMessage('base:adventurer-row', 1)).toBeUndefined();
  });
});

describe('action preview scope', () => {
  const previews: ActionPreviewSet = {
    schemaVersion: 2,
    gameId: 'game-1',
    revision: 4,
    actorId: 'p1',
    items: [{ kind: 'purchase', status: 'requires-lifecycle', command: { type: 'BUY_CARD', cardId: 'card-1' }, cardId: 'card-1' }],
  };

  it('exposes only previews bound to the current game, actor, and revision', () => {
    expect(actionPreviewItemsForScope(previews, { gameId: 'game-1', revision: 4, actorId: 'p1' })).toEqual(previews.items);
    expect(actionPreviewItemsForScope(previews, { gameId: 'other', revision: 4, actorId: 'p1' })).toEqual([]);
    expect(actionPreviewItemsForScope(previews, { gameId: 'game-1', revision: 5, actorId: 'p1' })).toEqual([]);
    expect(actionPreviewItemsForScope(previews, { gameId: 'game-1', revision: 4, actorId: 'p2' })).toEqual([]);
  });
});

describe('public table new-card indicator', () => {
  it('only flags newly added public cards, not removals or reordering', () => {
    expect(hasUnviewedCardIds(['a', 'b'], ['b'])).toBe(false);
    expect(hasUnviewedCardIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(hasUnviewedCardIds(['a', 'b'], ['b', 'c'])).toBe(true);
  });
});
