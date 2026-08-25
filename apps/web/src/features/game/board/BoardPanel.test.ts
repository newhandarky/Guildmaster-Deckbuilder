import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActionPreviewSet, CardDefinition, CardInstance, PublicEnemyTargetState, ZoneState } from '@guildmaster/game-protocol';
import { createPresentationResolver } from '@guildmaster/presentation-core';
import { BoardPanel } from './BoardPanel.js';
import { actionPreviewItemsForScope } from './action-preview-scope.js';
import { combatTargetStatusMessage } from './combat-target-status.js';
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

describe('public table simultaneous layout', () => {
  it('renders encounter and tavern zones together without tab semantics while preserving every action', () => {
    const definitionList: CardDefinition[] = [
      { id: 'test:boss', name: 'Boss', type: 'boss', copies: 1, combat: 5, source: 'test' },
      { id: 'test:monster', name: 'Monster', type: 'monster', copies: 1, combat: 3, source: 'test' },
      { id: 'test:adventurer', name: 'Adventurer', type: 'adventurer', copies: 1, cost: 2, source: 'test' },
      { id: 'test:item', name: 'Item', type: 'item', copies: 1, cost: 1, source: 'test' },
    ];
    const definitions = Object.fromEntries(definitionList.map((definition) => [definition.id, definition]));
    const cards: Record<string, CardInstance> = {
      boss: { id: 'boss', definitionId: 'test:boss' },
      monster: { id: 'monster', definitionId: 'test:monster' },
      adventurer: { id: 'adventurer', definitionId: 'test:adventurer' },
      item: { id: 'item', definitionId: 'test:item' },
    };
    const zones: Record<string, ZoneState> = {
      'base:boss-row': { zoneId: 'base:boss-row', kind: 'faceUpRow', visibility: 'public', cardIds: ['boss'] },
      'base:monster-row': { zoneId: 'base:monster-row', kind: 'faceUpRow', visibility: 'public', cardIds: ['monster'] },
      'base:adventurer-row': { zoneId: 'base:adventurer-row', kind: 'faceUpRow', visibility: 'public', cardIds: ['adventurer'] },
      'base:item-row': { zoneId: 'base:item-row', kind: 'faceUpRow', visibility: 'public', cardIds: ['item'] },
    };
    const targets: Record<string, PublicEnemyTargetState> = {
      boss: { targetId: 'target-boss', cardInstanceId: 'boss', kind: 'boss', status: 'available', attachments: [], moduleState: {} },
      monster: { targetId: 'target-monster', cardInstanceId: 'monster', kind: 'monster', status: 'available', attachments: [], moduleState: {} },
    };
    const legalCommands = [
      { type: 'ATTACK_TARGET' as const, targetId: 'target-boss' },
      { type: 'ATTACK_TARGET' as const, targetId: 'target-monster' },
      { type: 'BUY_CARD' as const, cardId: 'adventurer' },
      { type: 'BUY_CARD' as const, cardId: 'item' },
    ];
    const markup = renderToStaticMarkup(createElement(BoardPanel, {
      zones,
      targets,
      definitions,
      cards,
      presentation: createPresentationResolver([]),
      legalCommands,
      actionPreviews: { schemaVersion: 2, gameId: 'game', revision: 1, actorId: 'p1', items: [] },
      previewScope: { gameId: 'game', revision: 1, actorId: 'p1' },
      onInspect: () => undefined,
    }));

    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain('data-testid="encounter-area"');
    expect(markup).toContain('data-testid="tavern-area"');
    expect(markup.match(/public-card-grid/g)?.length).toBeGreaterThanOrEqual(4);
    for (const zoneId of ['base:boss-row', 'base:monster-row', 'base:adventurer-row', 'base:item-row']) {
      expect(markup).toContain(`data-zone-id="${zoneId}"`);
    }
    expect(markup.match(/data-legal-action="true"/g)).toHaveLength(4);
    expect(markup).toContain('動作：一般討伐');
    expect(markup).toContain('動作：招募');
    expect(markup).toContain('動作：購買');
  });

  it('keeps normal and combat-assist attacks as distinct player-selectable actions', () => {
    const definitions: Record<string, CardDefinition> = {
      'test:monster': { id: 'test:monster', name: 'Monster', type: 'monster', copies: 1, combat: 3, source: 'test' },
      'test:mage': { id: 'test:mage', name: 'Mage', type: 'adventurer', copies: 1, combat: 0, source: 'test' },
    };
    const cards: Record<string, CardInstance> = { monster: { id: 'monster', definitionId: 'test:monster' }, mage: { id: 'mage', definitionId: 'test:mage' } };
    const normal = { type: 'ATTACK_TARGET' as const, targetId: 'target-monster' };
    const assist = { ...normal, combatAssistCardId: 'mage' };
    const attackPreview = (command: typeof normal | typeof assist, requiredCombat: number): ActionPreviewSet['items'][number] => ({
      kind: 'attack', status: 'ready', command, targetId: 'target-monster', requiredCombat,
      committedCombat: requiredCombat, surplusCombat: 0, partySlotCount: 1,
      participantCardIds: ['mage'], outcome: { kind: 'defeat-target' },
    });
    const markup = renderToStaticMarkup(createElement(BoardPanel, {
      zones: {
        'base:boss-row': { zoneId: 'base:boss-row', kind: 'faceUpRow', visibility: 'public', cardIds: [] },
        'base:monster-row': { zoneId: 'base:monster-row', kind: 'faceUpRow', visibility: 'public', cardIds: ['monster'] },
        'base:adventurer-row': { zoneId: 'base:adventurer-row', kind: 'faceUpRow', visibility: 'public', cardIds: [] },
        'base:item-row': { zoneId: 'base:item-row', kind: 'faceUpRow', visibility: 'public', cardIds: [] },
      },
      targets: { monster: { targetId: 'target-monster', cardInstanceId: 'monster', kind: 'monster', status: 'available', attachments: [], moduleState: {} } },
      definitions, cards, presentation: createPresentationResolver([]), legalCommands: [normal, assist],
      actionPreviews: { schemaVersion: 2, gameId: 'game', revision: 1, actorId: 'p1', items: [attackPreview(normal, 6), attackPreview(assist, 3)] },
      previewScope: { gameId: 'game', revision: 1, actorId: 'p1' }, onInspect: () => undefined,
    }));
    expect(markup).toContain('動作：一般討伐、技能討伐（Mage）');
    expect(markup).toContain('data-legal-action="true"');
    expect(markup).not.toContain('data-testid="action-preview"');
    expect(markup).not.toContain('需求戰力');
  });
});

describe('public enemy combat status', () => {
  const target: PublicEnemyTargetState = {
    targetId: 'target-1',
    cardInstanceId: 'monster-1',
    kind: 'monster',
    status: 'available',
    attachments: [],
    moduleState: {},
  };

  it('uses player-facing copy when the projected combat suppresses equipment', () => {
    expect(combatTargetStatusMessage({ ...target, equipmentSuppressed: true }))
      .toBe('討伐此目標時，所有裝備在本次戰鬥中失效。');
    expect(combatTargetStatusMessage({ ...target, maximumPartySlots: 3 })).toBe('本次討伐最多使用隊伍最前方連續的 3 名冒險者。');
    expect(combatTargetStatusMessage({ ...target, maximumPartySlots: 1 })).toBe('本次討伐只能使用隊伍最前方 1 名冒險者。');
    expect(combatTargetStatusMessage(target)).toBeUndefined();
  });
});
