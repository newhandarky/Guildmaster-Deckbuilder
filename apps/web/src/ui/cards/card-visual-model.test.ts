import { describe, expect, it } from 'vitest';
import type { CardDefinition, CardInstance, GameCommand } from '@guildmaster/game-protocol';
import type { PresentationViewModel } from '@guildmaster/presentation-core';
import { buildCardVisualModel, cardAccessibleName, commandAction, equipmentSelectionAction, isCardActionCurrent } from './card-visual-model.js';

const instance: CardInstance = { id: 'card-1', definitionId: 'demo:adventurer/one' };
const presentation: PresentationViewModel = {
  definitionId: instance.definitionId,
  displayName: '示範冒險者',
  portraitAssetKey: 'placeholder:one',
  portraitAsset: { key: 'placeholder:one', altText: '示範冒險者 placeholder' },
  shortDisplayText: '短摘要',
  detailDisplayText: '完整詳情',
  source: 'pack',
  presentationPackId: 'presentation:test',
  presentationVersion: '1.0.0',
};

function definition(type = 'adventurer'): CardDefinition {
  return { id: instance.definitionId, name: 'mechanics-only', type, copies: 1, cost: 2, combat: 3, purchasePower: 4, honor: 5, tags: ['demo'], source: 'test' };
}

describe('card visual model', () => {
  const templateCases: readonly (readonly [string, string])[] = [
    ['starter', 'full-art'],
    ['adventurer', 'character'],
    ['equipment', 'supply'],
    ['item', 'supply'],
    ['monster', 'enemy'],
    ['boss', 'boss'],
    ['future-card-type', 'standard'],
  ];

  it.each(templateCases)('maps %s to the safe %s template', (type: string, template: string) => {
    expect(buildCardVisualModel({ instance, definition: definition(type), presentation }).template).toBe(template);
  });

  it('keeps a stable metric order and limits the permanent rail to three metrics', () => {
    const model = buildCardVisualModel({ instance, definition: definition(), presentation });
    expect(model.metrics.map(({ kind }) => kind)).toEqual(['cost', 'combat', 'purchasePower']);
    expect(model.detailMetrics.map(({ kind }) => kind)).toEqual(['cost', 'combat', 'purchasePower', 'honor']);
  });

  it('uses neutral presentation fallback without changing mechanics identity', () => {
    expect(buildCardVisualModel({ instance, definition: definition() })).toMatchObject({
      definitionId: instance.definitionId,
      displayName: '中性卡牌 one',
      art: { key: 'placeholder:neutral-card' },
      template: 'character',
    });
  });

  it('does not mutate definitions, presentation, tags, or legal commands', () => {
    const cardDefinition = definition();
    const legalCommand: GameCommand = { type: 'PLAY_ADVENTURER', cardId: instance.id };
    const before = JSON.stringify({ cardDefinition, presentation, legalCommand });
    const action = commandAction('play', '加入隊伍', legalCommand);
    const model = buildCardVisualModel({ instance, definition: cardDefinition, presentation, interactionState: 'legal', action });
    expect(JSON.stringify({ cardDefinition, presentation, legalCommand })).toBe(before);
    expect(model.tags).not.toBe(cardDefinition.tags);
    expect(model.action).toEqual(action);
  });

  it('names the exact legal action while keeping details as the card activation behavior', () => {
    const action = commandAction('play', '加入隊伍', { type: 'PLAY_ADVENTURER', cardId: instance.id });
    const model = buildCardVisualModel({
      instance,
      definition: definition(),
      presentation,
      interactionState: 'legal',
      action,
    });
    expect(cardAccessibleName(model)).toBe('示範冒險者，冒險者，費用 2，戰力 3，購買力 4，可執行，動作：加入隊伍，開啟卡牌詳情');
  });

  it('keeps unavailable cards inspectable without inventing an action', () => {
    const model = buildCardVisualModel({ instance, definition: definition(), presentation, interactionState: 'unavailable' });
    expect(model.stateLabel).toBe('不可執行');
    expect(model.stateDescription).toBe('目前不可執行');
    expect(model.action).toBeUndefined();
  });

  it('creates equipment selection only from the exact supplied legal commands', () => {
    const legal: Extract<GameCommand, { type: 'EQUIP_ITEM' }>[] = [
      { type: 'EQUIP_ITEM', cardId: 'equipment-1', adventurerId: 'adventurer-1' },
    ];
    expect(equipmentSelectionAction('equipment-1', legal)).toMatchObject({ kind: 'select-equipment', commands: legal });
    expect(equipmentSelectionAction('equipment-1', [])).toBeUndefined();
  });

  it('invalidates a details command as soon as it leaves the authoritative legal set', () => {
    const play: GameCommand = { type: 'PLAY_ADVENTURER', cardId: instance.id };
    const action = commandAction('play', '加入隊伍', play);
    expect(isCardActionCurrent(action, [structuredClone(play)])).toBe(true);
    expect(isCardActionCurrent(action, [{ type: 'END_PHASE', phase: 'action1' }])).toBe(false);
  });

  it('requires the complete current equipment target set', () => {
    const first: Extract<GameCommand, { type: 'EQUIP_ITEM' }> = { type: 'EQUIP_ITEM', cardId: 'equipment-1', adventurerId: 'adventurer-1' };
    const second: Extract<GameCommand, { type: 'EQUIP_ITEM' }> = { type: 'EQUIP_ITEM', cardId: 'equipment-1', adventurerId: 'adventurer-2' };
    const action = equipmentSelectionAction('equipment-1', [first, second]);
    expect(isCardActionCurrent(action, [second, first])).toBe(true);
    expect(isCardActionCurrent(action, [first])).toBe(false);
  });
});
