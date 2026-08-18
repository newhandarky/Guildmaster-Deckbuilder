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

  it('does not treat inherited object properties as registered card types', () => {
    const model = buildCardVisualModel({ instance, definition: definition('toString'), presentation });
    expect(model).toMatchObject({
      cardType: 'toString',
      cardTypeLabel: '特殊卡牌',
      template: 'standard',
      appearance: 'standard',
    });
    expect(model.corners[0]).toEqual({
      slot: 'type',
      iconKey: 'card-type-standard',
      accessibleLabel: '卡牌類型：特殊卡牌',
    });
  });

  it('keeps complete detail metrics and maps the four fixed card corners', () => {
    const model = buildCardVisualModel({ instance, definition: definition(), presentation });
    expect(model.detailMetrics.map(({ kind }) => kind)).toEqual(['cost', 'combat', 'purchasePower', 'honor']);
    expect(model.corners).toEqual([
      { slot: 'type', iconKey: 'card-type-standard', accessibleLabel: '卡牌類型：冒險者' },
      { slot: 'honor', iconKey: 'metric-honor-star', value: 5, accessibleLabel: '榮譽 5' },
      { slot: 'combat', iconKey: 'metric-combat', value: 3, accessibleLabel: '印刷戰力 3' },
      { slot: 'purchase', iconKey: 'metric-purchase', value: 2, accessibleLabel: '費用 2' },
    ]);
  });

  it.each([
    ['adventurer', 'adventurer'],
    ['boss', 'boss'],
    ['monster', 'enemy'],
    ['item', 'item'],
    ['equipment', 'equipment'],
    ['helper', 'helper'],
    ['bond', 'bond'],
    ['future-card-type', 'standard'],
  ] as const)('maps %s to the %s appearance', (type, appearance) => {
    expect(buildCardVisualModel({ instance, definition: definition(type), presentation }).appearance).toBe(appearance);
  });

  it.each([
    ['helper', '協助者'],
    ['bond', '羈絆'],
  ] as const)('uses the player-facing %s card type label', (type, label) => {
    const model = buildCardVisualModel({ instance, definition: definition(type), presentation });
    expect(model.cardTypeLabel).toBe(label);
    expect(model.corners[0]?.accessibleLabel).toBe(`卡牌類型：${label}`);
  });

  it('omits undefined corner values while preserving an explicit zero', () => {
    const cardDefinition: CardDefinition = { id: instance.definitionId, name: 'mechanics-only', type: 'item', copies: 1, cost: 0, tags: ['demo'], source: 'test' };
    expect(buildCardVisualModel({ instance, definition: cardDefinition, presentation }).corners).toEqual([
      { slot: 'type', iconKey: 'card-type-item', accessibleLabel: '卡牌類型：道具' },
      { slot: 'purchase', iconKey: 'metric-purchase', value: 0, accessibleLabel: '費用 0' },
    ]);
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
    expect(model.debugTags).not.toBe(cardDefinition.tags);
    expect(model.action).toEqual(action);
  });

  it('maps professions to player-facing labels and leaves raw tags in debug metadata', () => {
    const cardDefinition = { ...definition(), tags: ['profession:tank', 'playtest:effects-disabled', 'project-policy:digital-copy-count', 'affinity:mage'] };
    const model = buildCardVisualModel({ instance, definition: cardDefinition, presentation });
    expect(model.appearance).toBe('adventurer');
    expect(model.profession).toBe('tank');
    expect(model.publicTags).toEqual([{ label: '坦克', iconKey: 'profession-tank', tone: 'tank' }]);
    expect(model.corners[0]).toEqual({ slot: 'type', iconKey: 'profession-tank', accessibleLabel: '職業：坦克' });
    expect(model.debugTags).toEqual(cardDefinition.tags);
  });

  it('ignores inherited object properties masquerading as profession tokens', () => {
    const cardDefinition = { ...definition(), tags: ['profession:toString'] };
    const model = buildCardVisualModel({ instance, definition: cardDefinition, presentation });
    expect(model.profession).toBeUndefined();
    expect(model.publicTags).toEqual([]);
    expect(model.corners[0]).toEqual({
      slot: 'type',
      iconKey: 'card-type-standard',
      accessibleLabel: '卡牌類型：冒險者',
    });
  });

  it('copies the exact authoritative preview into the presentation model', () => {
    const command: Extract<GameCommand, { type: 'BUY_CARD' }> = { type: 'BUY_CARD', cardId: instance.id };
    const action = commandAction('buy', '招募', command);
    const actionPreview = {
      kind: 'purchase' as const,
      status: 'ready' as const,
      command,
      cardId: instance.id,
      printedCost: 2,
      effectiveCost: 2,
      appliedModifiers: [],
      availablePurchasePower: 3,
      remainingPurchasePower: 1,
    };
    const model = buildCardVisualModel({ instance, definition: definition(), presentation, action, actionPreview });
    expect(model.actionPreview).toEqual(actionPreview);
    expect(model.actionPreview).not.toBe(actionPreview);
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
    expect(cardAccessibleName(model)).toBe('示範冒險者，冒險者，費用 2，印刷戰力 3，購買力 4，榮譽 5，可執行，動作：加入隊伍，開啟卡牌詳情');
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
