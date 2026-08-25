import type {
  CounterConsentReasonCode,
  DomainEvent,
  GameCommand,
  PlayerView,
} from '@guildmaster/game-protocol';
import type { LifecycleCopyResolver } from './lifecycle-copy.js';

type ChoiceCommand = Extract<GameCommand, { type: 'RESOLVE_EFFECT_CHOICE' }>;
type OrderCommand = Extract<GameCommand, { type: 'RESOLVE_EFFECT_ORDER' }>;
type ConsentCommand = Extract<GameCommand, {
  type: 'RESPOND_COUNTER_CONSENT' | 'CANCEL_COUNTER_CONSENT' | 'EXPIRE_COUNTER_CONSENT';
}>;

export type LifecycleInteractionAction = {
  id: string;
  kind: 'choice' | 'accept' | 'decline' | 'cancel' | 'expire';
  label: string;
  command: GameCommand;
  emphasis: 'primary' | 'secondary' | 'danger';
  requiresConfirmation: boolean;
};

export type LifecycleActorProgress = {
  actorId: string;
  name: string;
  status: 'accepted' | 'waiting';
};

type LifecycleInteractionBase = {
  key: string;
  title: string;
  description: string;
};

export type LifecycleInteractionModel =
  | { kind: 'none'; key: 'none' }
  | (LifecycleInteractionBase & {
      kind: 'choice';
      executionId: string;
      choiceId: string;
      actions: readonly LifecycleInteractionAction[];
    })
  | (LifecycleInteractionBase & {
      kind: 'counter-consent';
      requestId: string;
      requesterName: string;
      progress: readonly LifecycleActorProgress[];
      actions: readonly LifecycleInteractionAction[];
    })
  | (LifecycleInteractionBase & {
      kind: 'waiting';
      reason: 'other-actor' | 'diagnostic';
      progress?: readonly LifecycleActorProgress[];
    })
  | (LifecycleInteractionBase & {
      kind: 'terminal-result';
      reasonCode: CounterConsentReasonCode;
      tone: 'success' | 'neutral';
    });

const consentReasonCopy: Record<CounterConsentReasonCode, { title: string; description: string; tone: 'success' | 'neutral' }> = {
  CONSENT_REQUESTED: { title: '公開請求已提出', description: '正在等待需要回覆的玩家。', tone: 'neutral' },
  ACCEPT_RECORDED: { title: '已記錄同意', description: '仍在等待其他玩家回覆。', tone: 'neutral' },
  ALL_REQUIRED_ACTORS_ACCEPTED: { title: '全體已同意', description: '這項資訊已依規則公開。', tone: 'success' },
  REQUIRED_ACTOR_DECLINED: { title: '公開請求未通過', description: '至少一位必要玩家不同意，本次資訊不公開。', tone: 'neutral' },
  REQUESTER_CANCELLED: { title: '公開請求已取消', description: '提出請求的玩家取消了本次公開。', tone: 'neutral' },
  REQUEST_EXPIRED: { title: '公開請求已結束', description: '這是規則指令造成的明確結束，不使用倒數計時。', tone: 'neutral' },
};

const terminalConsentEvent: Record<Exclude<CounterConsentReasonCode, 'CONSENT_REQUESTED' | 'ACCEPT_RECORDED'>, { status: string; eventType: string }> = {
  ALL_REQUIRED_ACTORS_ACCEPTED: { status: 'accepted', eventType: 'COUNTER_CONSENT_ACCEPTED' },
  REQUIRED_ACTOR_DECLINED: { status: 'declined', eventType: 'COUNTER_CONSENT_DECLINED' },
  REQUESTER_CANCELLED: { status: 'cancelled', eventType: 'COUNTER_CONSENT_CANCELLED' },
  REQUEST_EXPIRED: { status: 'expired', eventType: 'COUNTER_CONSENT_EXPIRED' },
};

function playerNames(view: PlayerView): ReadonlyMap<string, string> {
  return new Map([
    [view.self.id, view.self.name],
    ...view.opponents.map((player) => [player.id, player.name] as const),
  ]);
}

function terminalResult(view: PlayerView, events: readonly DomainEvent[]): LifecycleInteractionModel | undefined {
  const event = [...events].reverse().find((candidate) => {
    if (candidate.revision !== view.revision || candidate.payload?.kind !== 'counter-consent') return false;
    const reasonCode = candidate.payload.evaluation.reasonCode;
    const expected = reasonCode in terminalConsentEvent
      ? terminalConsentEvent[reasonCode as keyof typeof terminalConsentEvent]
      : undefined;
    return expected?.status === candidate.payload.evaluation.status && expected.eventType === candidate.type;
  });
  if (!event || event.payload?.kind !== 'counter-consent') return undefined;
  const copy = consentReasonCopy[event.payload.evaluation.reasonCode];
  return {
    kind: 'terminal-result',
    key: `consent-result:${event.eventId}`,
    reasonCode: event.payload.evaluation.reasonCode,
    ...copy,
  };
}

function choiceModel(
  view: PlayerView,
  commands: readonly ChoiceCommand[],
  resolver: LifecycleCopyResolver,
  optionLabel?: (choiceId: string, optionId: string, index: number) => string | undefined,
): LifecycleInteractionModel | undefined {
  if (commands.length === 0) return undefined;
  const groups = new Map<string, ChoiceCommand[]>();
  for (const command of commands) {
    const key = `${command.executionId}\u0000${command.choiceId}`;
    groups.set(key, [...(groups.get(key) ?? []), command]);
  }
  if (groups.size !== 1) {
    return {
      kind: 'waiting',
      key: 'choice:diagnostic',
      reason: 'diagnostic',
      title: '目前選擇無法安全顯示',
      description: '合法指令包含多個互斥的選擇群組；介面不會猜測應執行哪一組。',
    };
  }
  const options = [...groups.values()][0]!;
  const first = options[0]!;
  const copy = resolver.resolveChoice(first.choiceId);
  return {
    kind: 'choice',
    key: `choice:${first.executionId}:${first.choiceId}`,
    executionId: first.executionId,
    choiceId: first.choiceId,
    title: copy.title,
    description: copy.description,
    actions: options.map((command, index) => ({
      id: `choice:${command.executionId}:${command.choiceId}:${command.optionId}`,
      kind: 'choice',
      label: command.choiceId === 'combat-departure:optional-replacements'
        ? (() => {
            const cardIds = view.decisionPrompt?.options.find(({ id }) => id === command.optionId)?.selectedCardIds ?? [];
            return cardIds.length ? `套用離場替代：${cardIds.map((cardId) => optionLabel?.(command.choiceId, cardId, index) ?? cardId).join('、')}` : '不套用離場替代';
          })()
        : optionLabel?.(command.choiceId, command.optionId, index) ?? copy.optionLabel(command.optionId, index),
      command,
      emphasis: index === 0 ? 'primary' : 'secondary',
      requiresConfirmation: false,
    })),
  };
}

function orderModel(
  view: PlayerView,
  commands: readonly OrderCommand[],
  resolver: LifecycleCopyResolver,
  optionLabel?: (choiceId: string, optionId: string, index: number) => string | undefined,
): LifecycleInteractionModel | undefined {
  if (!commands.length) return undefined;
  const groups = new Map<string, OrderCommand[]>();
  for (const command of commands) {
    const key = `${command.executionId}\u0000${command.orderId}`;
    groups.set(key, [...(groups.get(key) ?? []), command]);
  }
  const prompt = view.decisionPrompt;
  if (groups.size !== 1 || prompt?.decisionKind !== 'choose-order' || !prompt.order) return { kind: 'waiting', key: 'order:diagnostic', reason: 'diagnostic', title: '目前排序無法安全顯示', description: '排序指令與私人 PlayerView 資料不一致；介面不會猜測順序。' };
  const options = [...groups.values()][0]!; const first = options[0]!; const inspected = [...prompt.order.cardIds].sort();
  const malformed = options.some((command) => {
    const ids = [...command.orderedCardIds, ...(command.removeCardId ? [command.removeCardId] : [])];
    return prompt.choiceId !== first.orderId || command.orderId !== first.orderId || command.executionId !== first.executionId || new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify(inspected) || (!prompt.order!.mayRemove && Boolean(command.removeCardId));
  });
  if (malformed) return { kind: 'waiting', key: 'order:diagnostic', reason: 'diagnostic', title: '目前排序無法安全顯示', description: '合法指令不是目前卡牌的完整排列；介面已停止送出指令。' };
  const copy = resolver.resolveChoice(first.orderId);
  const label = (cardId: string, index: number) => optionLabel?.(first.orderId, cardId, index) ?? cardId;
  const describeOrder = (command: OrderCommand, index: number) => prompt.order!.kind === 'party'
    ? `隊伍順序：${command.orderedCardIds.map((id) => label(id, index)).join(' → ')}`
    : `${command.removeCardId ? `移除「${label(command.removeCardId, index)}」；` : ''}由底至頂：${command.orderedCardIds.map((id) => label(id, index)).join(' → ')}`;
  return {
    kind: 'choice', key: `order:${first.executionId}:${first.orderId}`, executionId: first.executionId, choiceId: first.orderId,
    title: copy.title,
    description: copy.description,
    actions: options.map((command, index) => ({
      id: `order:${command.executionId}:${command.orderId}:${index}`, kind: 'choice', command,
      label: describeOrder(command, index),
      emphasis: index === 0 ? 'primary' : 'secondary', requiresConfirmation: false,
    })),
  };
}

function consentActions(commands: readonly ConsentCommand[]): LifecycleInteractionAction[] {
  const actionFor = (command: ConsentCommand): LifecycleInteractionAction => {
    if (command.type === 'RESPOND_COUNTER_CONSENT' && command.response === 'accept') {
      return { id: `consent:${command.requestId}:accept`, kind: 'accept', label: '同意公開', command, emphasis: 'primary', requiresConfirmation: false };
    }
    if (command.type === 'RESPOND_COUNTER_CONSENT') {
      return { id: `consent:${command.requestId}:decline`, kind: 'decline', label: '不同意', command, emphasis: 'danger', requiresConfirmation: true };
    }
    if (command.type === 'CANCEL_COUNTER_CONSENT') {
      return { id: `consent:${command.requestId}:cancel`, kind: 'cancel', label: '取消公開請求', command, emphasis: 'danger', requiresConfirmation: true };
    }
    return { id: `consent:${command.requestId}:expire`, kind: 'expire', label: '依規則結束等待', command, emphasis: 'danger', requiresConfirmation: true };
  };
  const order: Record<LifecycleInteractionAction['kind'], number> = { choice: 0, accept: 0, decline: 1, cancel: 2, expire: 3 };
  return commands.map(actionFor).sort((left, right) => order[left.kind] - order[right.kind]);
}

function consentModel(
  view: PlayerView,
  commands: readonly ConsentCommand[],
  resolver: LifecycleCopyResolver,
): LifecycleInteractionModel {
  const pending = view.pendingCounterConsent!;
  const names = playerNames(view);
  const accepted = new Set(pending.acceptedActorIds);
  const invalidActors = pending.requiredActorIds.length === 0
    || new Set(pending.requiredActorIds).size !== pending.requiredActorIds.length
    || new Set(pending.acceptedActorIds).size !== pending.acceptedActorIds.length
    || pending.acceptedActorIds.some((actorId) => !pending.requiredActorIds.includes(actorId))
    || !names.has(pending.requesterId)
    || !names.has(pending.counterOwnerId);
  const mismatchedRequest = commands.some((command) => command.requestId !== pending.requestId);
  if (invalidActors || mismatchedRequest) {
    return {
      kind: 'waiting',
      key: `consent:${pending.requestId}:diagnostic`,
      reason: 'diagnostic',
      title: '目前同意請求無法安全顯示',
      description: '請求的玩家、進度或合法指令彼此不一致；介面不會猜測或重建指令。',
    };
  }
  const progress = pending.requiredActorIds.map((actorId) => ({
    actorId,
    name: names.get(actorId) ?? actorId,
    status: accepted.has(actorId) ? 'accepted' as const : 'waiting' as const,
  }));
  const copy = resolver.resolveConsent(pending.policy);
  const requesterName = names.get(pending.requesterId) ?? pending.requesterId;
  const actions = consentActions(commands.filter((command) => command.requestId === pending.requestId));
  const base = {
    key: `consent:${pending.requestId}`,
    title: copy?.title ?? '需要全體同意',
    description: copy?.description ?? `${requesterName} 要求公開一項需全體同意的資訊。`,
    requesterName,
    progress,
  };
  return actions.length > 0
    ? { kind: 'counter-consent', requestId: pending.requestId, actions, ...base }
    : { kind: 'waiting', reason: 'other-actor', ...base };
}

export function buildLifecycleInteractionModel(
  view: PlayerView,
  legalCommands: readonly GameCommand[],
  events: readonly DomainEvent[],
  resolver: LifecycleCopyResolver,
  optionLabel?: (choiceId: string, optionId: string, index: number) => string | undefined,
): LifecycleInteractionModel {
  const choiceCommands = legalCommands.filter((command): command is ChoiceCommand => command.type === 'RESOLVE_EFFECT_CHOICE');
  const orderCommands = legalCommands.filter((command): command is OrderCommand => command.type === 'RESOLVE_EFFECT_ORDER');
  const consentCommands = legalCommands.filter((command): command is ConsentCommand =>
    command.type === 'RESPOND_COUNTER_CONSENT'
    || command.type === 'CANCEL_COUNTER_CONSENT'
    || command.type === 'EXPIRE_COUNTER_CONSENT'
  );
  if (view.pendingCounterConsent && (choiceCommands.length > 0 || orderCommands.length > 0)) {
    return {
      kind: 'waiting',
      key: 'lifecycle:diagnostic',
      reason: 'diagnostic',
      title: '目前互動狀態不一致',
      description: '同意請求與單人選擇不可同時操作；介面已停止送出指令。',
    };
  }
  if (view.pendingCounterConsent) return consentModel(view, consentCommands, resolver);
  if (consentCommands.length > 0) {
    return {
      kind: 'waiting',
      key: 'consent:missing-view',
      reason: 'diagnostic',
      title: '目前同意請求無法安全顯示',
      description: '合法指令缺少相符的 PlayerView 請求；介面不會猜測 requestId。',
    };
  }
  if (choiceCommands.length > 0 && orderCommands.length > 0) return { kind: 'waiting', key: 'decision:diagnostic', reason: 'diagnostic', title: '目前互動狀態不一致', description: '一般選擇與牌庫排序不可同時操作；介面已停止送出指令。' };
  return orderModel(view, orderCommands, resolver, optionLabel)
    ?? choiceModel(view, choiceCommands, resolver, optionLabel)
    ?? terminalResult(view, events)
    ?? { kind: 'none', key: 'none' };
}
