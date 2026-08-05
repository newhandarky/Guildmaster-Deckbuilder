import type { ActionPreviewItem, CardDefinition, CardInstance, GameCommand } from '@guildmaster/game-protocol';
import type { PresentationViewModel } from '@guildmaster/presentation-core';

export type CardTemplate = 'character' | 'standard' | 'supply' | 'enemy' | 'boss' | 'full-art';
export type CardInteractionState = 'default' | 'legal' | 'selected' | 'target' | 'unavailable';
export type CardMetricKind = 'cost' | 'combat' | 'purchasePower' | 'honor';

export type CardMetric = {
  kind: CardMetricKind;
  icon: string;
  label: string;
  value: number;
};

export type CardAction =
  | { kind: 'command'; id: string; label: string; command: GameCommand }
  | {
      kind: 'select-equipment';
      id: string;
      label: string;
      equipmentCardId: string;
      commands: readonly Extract<GameCommand, { type: 'EQUIP_ITEM' }>[];
    };

export type CardVisualViewModel = {
  instanceId?: string;
  definitionId: string;
  displayName: string;
  cardType: string;
  cardTypeLabel: string;
  template: CardTemplate;
  art: PresentationViewModel['portraitAsset'];
  shortDisplayText: string;
  detailDisplayText: string;
  metrics: readonly CardMetric[];
  detailMetrics: readonly CardMetric[];
  tags: readonly string[];
  interactionState: CardInteractionState;
  stateLabel: string;
  stateDescription: string;
  contextLabel?: string;
  action?: CardAction;
  actionPreview?: ActionPreviewItem;
};

type BuildCardVisualModelInput = {
  instance?: CardInstance | undefined;
  definition?: CardDefinition | undefined;
  presentation?: PresentationViewModel | undefined;
  interactionState?: CardInteractionState | undefined;
  contextLabel?: string | undefined;
  action?: CardAction | undefined;
  actionPreview?: ActionPreviewItem | undefined;
};

const typeTemplates: Readonly<Record<string, CardTemplate>> = {
  starter: 'full-art',
  adventurer: 'character',
  equipment: 'supply',
  item: 'supply',
  monster: 'enemy',
  boss: 'boss',
};

const typeLabels: Readonly<Record<string, string>> = {
  starter: '起始牌',
  adventurer: '冒險者',
  equipment: '裝備',
  item: '道具',
  monster: '魔物',
  boss: '魔王',
};

const stateLabels: Readonly<Record<CardInteractionState, string>> = {
  default: '可查看',
  legal: '可執行',
  selected: '已選取',
  target: '合法目標',
  unavailable: '不可執行',
};

const stateDescriptions: Readonly<Record<CardInteractionState, string>> = {
  ...stateLabels,
  unavailable: '目前不可執行',
};

function metricsFor(definition: CardDefinition | undefined): CardMetric[] {
  if (!definition) return [];
  const metrics: CardMetric[] = [];
  if (definition.cost !== undefined) metrics.push({ kind: 'cost', icon: '◈', label: '費用', value: definition.cost });
  if (definition.combat !== undefined) metrics.push({ kind: 'combat', icon: '⚔', label: '戰力', value: definition.combat });
  if (definition.purchasePower !== undefined) metrics.push({ kind: 'purchasePower', icon: '◆', label: '購買力', value: definition.purchasePower });
  if (definition.honor !== undefined) metrics.push({ kind: 'honor', icon: '✦', label: '榮譽', value: definition.honor });
  return metrics;
}

function fallbackPresentation(definitionId: string): Pick<CardVisualViewModel, 'displayName' | 'art' | 'shortDisplayText' | 'detailDisplayText'> {
  const shortId = definitionId.split('/').at(-1) ?? definitionId;
  return {
    displayName: `中性卡牌 ${shortId}`,
    art: { key: 'placeholder:neutral-card', altText: '中性卡牌圖像 placeholder' },
    shortDisplayText: '原創文字 placeholder；不影響遊戲規則。',
    detailDisplayText: '尚未提供此卡牌的詳細視覺說明。',
  };
}

export function buildCardVisualModel({
  instance,
  definition,
  presentation,
  interactionState = 'default',
  contextLabel,
  action,
  actionPreview,
}: BuildCardVisualModelInput): CardVisualViewModel {
  const definitionId = definition?.id ?? instance?.definitionId ?? presentation?.definitionId ?? 'unknown';
  const fallback = fallbackPresentation(definitionId);
  const detailMetrics = metricsFor(definition);
  const cardType = definition?.type ?? 'unknown';
  return {
    ...(instance ? { instanceId: instance.id } : {}),
    definitionId,
    displayName: presentation?.displayName ?? fallback.displayName,
    cardType,
    cardTypeLabel: typeLabels[cardType] ?? '特殊卡牌',
    template: typeTemplates[cardType] ?? 'standard',
    art: presentation?.portraitAsset ?? fallback.art,
    shortDisplayText: presentation?.shortDisplayText ?? fallback.shortDisplayText,
    detailDisplayText: presentation?.detailDisplayText ?? fallback.detailDisplayText,
    metrics: detailMetrics.slice(0, 3),
    detailMetrics,
    tags: [...(definition?.tags ?? [])],
    interactionState,
    stateLabel: stateLabels[interactionState],
    stateDescription: stateDescriptions[interactionState],
    ...(contextLabel ? { contextLabel } : {}),
    ...(action ? { action } : {}),
    ...(actionPreview ? { actionPreview: structuredClone(actionPreview) } : {}),
  };
}

export function commandAction(id: string, label: string, command: GameCommand): CardAction {
  return { kind: 'command', id, label, command };
}

export function equipmentSelectionAction(
  cardId: string,
  commands: readonly Extract<GameCommand, { type: 'EQUIP_ITEM' }>[],
): CardAction | undefined {
  return commands.length > 0
    ? { kind: 'select-equipment', id: `select-equipment:${cardId}`, label: '選擇配戴對象', equipmentCardId: cardId, commands: [...commands] }
    : undefined;
}

/** Gives inspectable cards a concise name without implying that opening details executes the action. */
export function cardAccessibleName(card: CardVisualViewModel): string {
  const metricSummary = card.metrics.map((metric) => `${metric.label} ${metric.value}`).join('，');
  const actionSummary = card.action ? `，動作：${card.action.label}` : '';
  return `${card.displayName}，${card.cardTypeLabel}${metricSummary ? `，${metricSummary}` : ''}，${card.stateDescription}${actionSummary}，開啟卡牌詳情`;
}

function commandFingerprint(command: GameCommand): string {
  return JSON.stringify(command);
}

/** Keeps details actions tied to the current authoritative legal-command set, even before a transaction commits. */
export function isCardActionCurrent(action: CardAction | undefined, legalCommands: readonly GameCommand[]): boolean {
  if (!action) return true;
  if (action.kind === 'command') {
    const expected = commandFingerprint(action.command);
    return legalCommands.some((command) => commandFingerprint(command) === expected);
  }
  const expected = action.commands.map(commandFingerprint).sort();
  const current = legalCommands
    .filter((command): command is Extract<GameCommand, { type: 'EQUIP_ITEM' }> =>
      command.type === 'EQUIP_ITEM' && command.cardId === action.equipmentCardId)
    .map(commandFingerprint)
    .sort();
  return JSON.stringify(current) === JSON.stringify(expected);
}
