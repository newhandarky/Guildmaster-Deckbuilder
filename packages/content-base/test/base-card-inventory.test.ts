import { describe, expect, it } from 'vitest';
import { baseCardInventory, validateBaseCardInventory } from '../src/index.js';
import { demoCards } from '../src/cards/demo-cards.js';

describe('verified base-card inventory', () => {
  it('is auditable, incomplete, and keeps every entry disabled', () => {
    expect(validateBaseCardInventory(baseCardInventory)).toEqual([]);
    expect(baseCardInventory.rosterStatus).toBe('incomplete');
    expect(baseCardInventory.cards.every((card) => card.activation === 'disabled')).toBe(true);
  });

  it('covers each current placeholder and marks it as original rather than official', () => {
    for (const definition of demoCards) {
      const entry = baseCardInventory.cards.find((card) => card.id === definition.id);
      expect(entry?.displayName.kind).toBe('original-placeholder');
      expect(entry?.copies.status).toBe('todo');
    }
  });

  it('records only directly confirmed official names and card types', () => {
    const official = baseCardInventory.cards.filter((card) => card.displayName.kind === 'official');
    expect(official.map((card) => card.displayName.value)).toEqual(['神樂', '巴風特', '奇美拉', '修爾蒂']);
    expect(official.every((card) => card.cardType.status === 'verified' && card.copies.status === 'todo')).toBe(true);
  });
});
