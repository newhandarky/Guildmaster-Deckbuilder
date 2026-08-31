import type { ActionPreviewItem, CardDefinition, CardInstance, GameCommand } from '@guildmaster/game-protocol';
import type { PresentationViewModel } from '@guildmaster/presentation-core';
import {
  appearanceForCardType,
  professionFromTags,
  professionPresentation,
  typeIconFor,
  type CardAppearance,
  type ProfessionKey,
} from './card-appearance.js';
import type { CardIconKey } from './card-icons.js';

export type AttachableCommand = Extract<GameCommand, { type: 'EQUIP_ITEM' | 'ATTACH_CARD' }>;

export type CardTemplate = 'character' | 'standard' | 'supply' | 'enemy' | 'boss' | 'full-art';
export type CardInteractionState = 'default' | 'legal' | 'selected' | 'target' | 'unavailable';
export type CardMetricKind = 'cost' | 'combat' | 'purchasePower' | 'honor';

export type CardMetric = {
  kind: CardMetricKind;
  iconKey: CardIconKey;
  label: string;
  value: number;
};

export type CardTag = {
  label: string;
  iconKey?: CardIconKey;
  tone?: 'melee' | 'tank' | 'ranged' | 'mage' | 'support';
};

export type CardCornerSlot = {
  slot: 'type' | 'honor' | 'combat' | 'purchase';
  iconKey: CardIconKey;
  value?: number;
  accessibleLabel: string;
};

export type DirectCardAction =
  | { kind: 'command'; id: string; label: string; command: GameCommand }
  | {
      kind: 'select-equipment';
      id: string;
      label: string;
      equipmentCardId: string;
      commands: readonly AttachableCommand[];
    };

export type CardAction = DirectCardAction | {
  kind: 'action-menu';
  id: string;
  label: string;
  actions: readonly DirectCardAction[];
};

export type CardVisualViewModel = {
  instanceId?: string;
  definitionId: string;
  displayName: string;
  cardType: string;
  cardTypeLabel: string;
  template: CardTemplate;
  appearance: CardAppearance;
  profession?: ProfessionKey;
  art: PresentationViewModel['portraitAsset'];
  shortDisplayText: string;
  detailDisplayText: string;
  corners: readonly CardCornerSlot[];
  detailMetrics: readonly CardMetric[];
  /** Player-facing classification only; raw mechanics tags stay in debug details. */
  publicTags: readonly CardTag[];
  debugTags: readonly string[];
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
  effectiveCombat?: number | undefined;
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
  helper: '協助者',
  bond: '羈絆',
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

function publicTagsFor(tags: readonly string[]): CardTag[] {
  const profession = professionFromTags(tags);
  if (!profession) return [];
  const presentation = professionPresentation[profession];
  return [{ label: presentation.label, iconKey: presentation.iconKey, tone: profession }];
}

function metricsFor(definition: CardDefinition | undefined): CardMetric[] {
  if (!definition) return [];
  const metrics: CardMetric[] = [];
  if (definition.cost !== undefined) metrics.push({ kind: 'cost', iconKey: 'metric-purchase', label: '費用', value: definition.cost });
  if (definition.combat !== undefined) metrics.push({ kind: 'combat', iconKey: 'metric-combat', label: '印刷戰力', value: definition.combat });
  if (definition.purchasePower !== undefined) metrics.push({ kind: 'purchasePower', iconKey: 'metric-purchase', label: '購買力', value: definition.purchasePower });
  if (definition.honor !== undefined) metrics.push({ kind: 'honor', iconKey: 'metric-honor-star', label: '榮譽', value: definition.honor });
  return metrics;
}

function metricsWithEffectiveCombat(definition: CardDefinition | undefined, effectiveCombat: number | undefined): CardMetric[] {
  const metrics = metricsFor(definition);
  if (effectiveCombat === undefined || definition?.combat === undefined) return metrics;
  return metrics.map((metric) => metric.kind === 'combat'
    ? { ...metric, label: effectiveCombat === definition.combat ? '戰力' : `目前戰力（印刷 ${definition.combat}）`, value: effectiveCombat }
    : metric);
}

function cornersFor(
  definition: CardDefinition | undefined,
  cardTypeLabel: string,
  appearance: CardAppearance,
  profession: ProfessionKey | undefined,
  effectiveCombat?: number,
): CardCornerSlot[] {
  const corners: CardCornerSlot[] = [{
    slot: 'type',
    iconKey: typeIconFor(definition?.type ?? 'unknown', appearance, profession),
    accessibleLabel: profession ? `職業：${professionPresentation[profession].label}` : `卡牌類型：${cardTypeLabel}`,
  }];
  if (!definition) return corners;
  if (definition.honor !== undefined) corners.push({ slot: 'honor', iconKey: 'metric-honor-star', value: definition.honor, accessibleLabel: `榮譽 ${definition.honor}` });
  if (definition.combat !== undefined) {
    const combat = effectiveCombat ?? definition.combat;
    corners.push({
      slot: 'combat', iconKey: 'metric-combat', value: combat,
      accessibleLabel: effectiveCombat === undefined ? `印刷戰力 ${definition.combat}` : combat === definition.combat ? `目前戰力 ${combat}` : `目前戰力 ${combat}，印刷戰力 ${definition.combat}`,
    });
  }
  if (definition.cost !== undefined) corners.push({ slot: 'purchase', iconKey: 'metric-purchase', value: definition.cost, accessibleLabel: `費用 ${definition.cost}` });
  else if (definition.purchasePower !== undefined) corners.push({ slot: 'purchase', iconKey: 'metric-purchase', value: definition.purchasePower, accessibleLabel: `購買力 ${definition.purchasePower}` });
  return corners;
}

function fallbackPresentation(definitionId: string): Pick<CardVisualViewModel, 'displayName' | 'art' | 'shortDisplayText' | 'detailDisplayText'> {
  const shortId = definitionId.split('/').at(-1) ?? definitionId;
  return {
    displayName: `中性卡牌 ${shortId}`,
    art: { key: 'placeholder:neutral-card', altText: '中性卡牌替代圖像' },
    shortDisplayText: '尚未提供完整卡牌說明；不影響遊戲規則。',
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
  effectiveCombat,
}: BuildCardVisualModelInput): CardVisualViewModel {
  const definitionId = definition?.id ?? instance?.definitionId ?? presentation?.definitionId ?? 'unknown';
  const fallback = fallbackPresentation(definitionId);
  const detailMetrics = metricsWithEffectiveCombat(definition, effectiveCombat);
  const cardType = definition?.type ?? 'unknown';
  const cardTypeLabel = Object.hasOwn(typeLabels, cardType)
    ? typeLabels[cardType] ?? '特殊卡牌'
    : '特殊卡牌';
  const appearance = appearanceForCardType(cardType);
  const profession = professionFromTags(definition?.tags ?? []);
  return {
    ...(instance ? { instanceId: instance.id } : {}),
    definitionId,
    displayName: presentation?.displayName ?? fallback.displayName,
    cardType,
    cardTypeLabel,
    template: Object.hasOwn(typeTemplates, cardType)
      ? typeTemplates[cardType] ?? 'standard'
      : 'standard',
    appearance,
    ...(profession ? { profession } : {}),
    art: presentation?.portraitAsset ?? fallback.art,
    shortDisplayText: presentation?.shortDisplayText ?? fallback.shortDisplayText,
    detailDisplayText: presentation?.detailDisplayText ?? fallback.detailDisplayText,
    corners: cornersFor(definition, cardTypeLabel, appearance, profession, effectiveCombat),
    detailMetrics,
    publicTags: publicTagsFor(definition?.tags ?? []),
    debugTags: [...(definition?.tags ?? [])],
    interactionState,
    stateLabel: stateLabels[interactionState],
    stateDescription: stateDescriptions[interactionState],
    ...(contextLabel ? { contextLabel } : {}),
    ...(action ? { action } : {}),
    ...(actionPreview ? { actionPreview: structuredClone(actionPreview) } : {}),
  };
}

export function commandAction(id: string, label: string, command: GameCommand): Extract<DirectCardAction, { kind: 'command' }> {
  return { kind: 'command', id, label, command };
}

export function equipmentSelectionAction(
  cardId: string,
  commands: readonly AttachableCommand[],
): Extract<DirectCardAction, { kind: 'select-equipment' }> | undefined {
  return commands.length > 0
    ? { kind: 'select-equipment', id: `select-equipment:${cardId}`, label: '選擇配戴對象', equipmentCardId: cardId, commands: [...commands] }
    : undefined;
}

export function cardActionMenu(id: string, actions: readonly DirectCardAction[]): CardAction | undefined {
  if (actions.length === 0) return undefined;
  if (actions.length === 1) return actions[0];
  return { kind: 'action-menu', id, label: '選擇動作', actions: [...actions] };
}

/** Gives inspectable cards a concise name without implying that opening details executes the action. */
export function cardAccessibleName(card: CardVisualViewModel): string {
  const metricSummary = card.detailMetrics.map((metric) => `${metric.label} ${metric.value}`).join('，');
  const actionSummary = card.action
    ? `，動作：${card.action.kind === 'action-menu' ? card.action.actions.map(({ label }) => label).join('、') : card.action.label}`
    : '';
  return `${card.displayName}，${card.cardTypeLabel}${metricSummary ? `，${metricSummary}` : ''}，${card.stateDescription}${actionSummary}，開啟卡牌詳情`;
}

function commandFingerprint(command: GameCommand): string {
  return JSON.stringify(command);
}

/** Keeps details actions tied to the current authoritative legal-command set, even before a transaction commits. */
export function isCardActionCurrent(action: CardAction | undefined, legalCommands: readonly GameCommand[]): boolean {
  if (!action) return true;
  if (action.kind === 'action-menu') return action.actions.every((candidate) => isCardActionCurrent(candidate, legalCommands));
  if (action.kind === 'command') {
    const expected = commandFingerprint(action.command);
    return legalCommands.some((command) => commandFingerprint(command) === expected);
  }
  const expected = action.commands.map(commandFingerprint).sort();
  const current = legalCommands
    .filter((command): command is AttachableCommand =>
      (command.type === 'EQUIP_ITEM' || command.type === 'ATTACH_CARD') && command.cardId === action.equipmentCardId)
    .map(commandFingerprint)
    .sort();
  return JSON.stringify(current) === JSON.stringify(expected);
}
