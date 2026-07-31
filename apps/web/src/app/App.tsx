import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDefinition, GameCommand } from '@guildmaster/game-protocol';
import { createPresentationResolver, neutralPlaceholderPresentationPack } from '@guildmaster/presentation-core';
import { BoardPanel } from '../features/game/board/BoardPanel.js';
import { PartyPanel } from '../features/game/party/PartyPanel.js';
import { Card } from '../ui/components/Card.js';
import { CardDetailsPanel } from '../ui/components/CardDetailsPanel.js';
import { LifecycleInteractionDock } from '../ui/components/LifecycleInteractionDock.js';
import { buildCardVisualModel, commandAction, equipmentSelectionAction, isCardActionCurrent, type CardAction, type CardVisualViewModel } from '../ui/cards/card-visual-model.js';
import { defaultLifecycleCopyResolver } from '../ui/lifecycle/lifecycle-copy.js';
import { buildLifecycleInteractionModel } from '../ui/lifecycle/lifecycle-interaction-model.js';
import { useGameStore } from '../store/game-store.js';

const phaseNames = { action1: '行動一', combat: '討伐', action2: '行動二', purchase: '購買', rest: '休息' } as const;

type CardInspection = {
  gameId: string;
  revision: number;
  card: CardVisualViewModel;
  trigger: HTMLButtonElement;
};

export function App() {
  const { view, definitions, events, legalCommands, error, scoreboard, replayReport, submit, restart, loadCurrentReplay, runReplay, clearReplayReport } = useGameStore();
  const [equipmentCardId, setEquipmentCardId] = useState<string>();
  const [inspection, setInspection] = useState<CardInspection>();
  const appRootRef = useRef<HTMLElement>(null);
  const interactionFallbackRef = useRef<HTMLParagraphElement>(null);
  const lifecycleHeadingRef = useRef<HTMLHeadingElement>(null);
  const priorPendingLifecycleRef = useRef<string>();
  const [replaySource, setReplaySource] = useState('');
  const presentation = useMemo(() => createPresentationResolver([neutralPlaceholderPresentationPack]), []);
  const cardDefinitions = useMemo(() => Object.fromEntries(Object.entries(view.cards).map(([id, card]) => [id, card.definitionId])), [view.cards]);
  const canAct = view.status === 'playing' || view.status === 'finalRound';
  const isAction = view.phase === 'action1' || view.phase === 'action2';
  const lifecycleInteraction = useMemo(
    () => buildLifecycleInteractionModel(view, legalCommands, events, defaultLifecycleCopyResolver),
    [events, legalCommands, view],
  );
  const lifecyclePending = lifecycleInteraction.kind === 'choice'
    || lifecycleInteraction.kind === 'counter-consent'
    || lifecycleInteraction.kind === 'waiting';
  const interactionHint = lifecyclePending ? '請先完成目前待處理的規則互動。' : !canAct ? '此對局目前不可操作。' : view.activePlayerId !== view.viewerId ? 'AI 正在行動，請等待你的回合。' : isAction ? '可操作手牌會以可點擊狀態顯示。' : `目前是${phaseNames[view.phase]}階段，行動手牌暫不可用。`;
  const legalEquipCommands = legalCommands.filter((command): command is Extract<GameCommand, { type: 'EQUIP_ITEM' }> => command.type === 'EQUIP_ITEM');
  const endPhaseCommand = legalCommands.find((command): command is Extract<GameCommand, { type: 'END_PHASE' }> => command.type === 'END_PHASE' && command.phase === view.phase);
  const currentInspection = inspection?.gameId === view.gameId
    && inspection.revision === view.revision
    && isCardActionCurrent(inspection.card.action, legalCommands)
    ? inspection
    : undefined;
  const clearTransientUi = () => {
    setEquipmentCardId(undefined);
    setInspection(undefined);
  };
  const submitAndClear = (command: GameCommand) => {
    clearTransientUi();
    submit(command);
  };
  const restartAndClear = () => {
    clearTransientUi();
    restart();
  };
  const inspectCard = (card: CardVisualViewModel, trigger: HTMLButtonElement) => {
    setInspection({ gameId: view.gameId, revision: view.revision, card, trigger });
  };
  const closeDetails = () => setInspection(undefined);
  const runCardAction = (action: CardAction) => {
    if (action.kind === 'select-equipment') {
      setEquipmentCardId(action.equipmentCardId);
      return;
    }
    submitAndClear(action.command);
  };
  const replayRunner = <section className="replay-runner" data-testid="replay-runner"><h2>Replay 診斷</h2><p>貼上 versioned Replay JSON；執行不會修改目前對局或本機存檔。為保護隱藏資訊，本機對局結束後才可匯出。</p><textarea aria-label="Replay JSON" value={replaySource} onChange={(event) => setReplaySource(event.target.value)} placeholder="貼上 ReplayBundle JSON" /><div className="controls"><button type="button" onClick={() => { const exported = loadCurrentReplay(); if (exported) setReplaySource(exported); }}>載入已完成對局 Replay</button><button data-testid="run-replay" type="button" onClick={() => runReplay(replaySource)}>執行 Replay</button>{replayReport ? <button type="button" onClick={clearReplayReport}>清除結果</button> : null}</div>{replayReport ? <output data-testid="replay-report" className={replayReport.status === 'completed' ? 'replay-success' : 'replay-failure'}>{replayReport.status === 'completed' ? <><strong>{replayReport.message}</strong><span>commands {replayReport.commandCount} · events {replayReport.eventCount} · revision {replayReport.revision}</span></> : <><strong>{replayReport.reasonCode ?? 'MALFORMED_REPLAY'}：{replayReport.message}</strong>{replayReport.commandIndex !== undefined ? <span>command #{replayReport.commandIndex + 1}{replayReport.commandId ? ` (${replayReport.commandId})` : ''}</span> : null}{replayReport.expectedRevision !== undefined ? <span>revision expected {replayReport.expectedRevision} / actual {replayReport.actualRevision}</span> : null}{replayReport.divergence ? <span>first divergence {replayReport.divergence.path}：expected {JSON.stringify(replayReport.divergence.expected)} / actual {JSON.stringify(replayReport.divergence.actual)}</span> : null}</>}</output> : null}</section>;

  useEffect(() => {
    const previous = priorPendingLifecycleRef.current;
    priorPendingLifecycleRef.current = lifecyclePending ? lifecycleInteraction.key : undefined;
    if (lifecyclePending && previous !== lifecycleInteraction.key) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => lifecycleHeadingRef.current?.focus());
        });
      });
      return;
    }
    if (previous && !lifecyclePending) window.requestAnimationFrame(() => interactionFallbackRef.current?.focus());
  }, [lifecycleInteraction.key, lifecyclePending]);

  if (scoreboard) return <main ref={appRootRef} className="app-shell" data-testid="game-app" tabIndex={-1}><section className="hero"><p className="eyebrow">文字版 MVP</p><h1>遠征結算</h1><p>{view.endState?.conditionId ?? '遊戲結束'}</p></section><section className="scoreboard"><h2>榮譽排名</h2>{scoreboard.map((row) => <div className="score-row" key={row.playerId}><strong>#{row.rank} {row.name}</strong><span>{row.honor} 榮譽</span><small>魔王 {row.defeatedBosses}／魔物 {row.defeatedMonsters}</small></div>)}</section>{replayRunner}<button className="primary" type="button" onClick={restartAndClear}>開啟新遠征</button></main>;

  return <main ref={appRootRef} className="app-shell" data-testid="game-app" tabIndex={-1}>
    <header className="hero"><div><p className="eyebrow">原創文字示範牌組 · 單機人機對戰</p><h1>晨星公會</h1><p>第 {view.round} 輪 · {phaseNames[view.phase]}階段</p></div><div className="status"><strong>{view.activePlayerId === view.viewerId ? '你的回合' : 'AI 正在行動'}</strong><span>版本 {view.revision}</span></div></header>
    {view.status === 'pendingOfficialRuling' ? <aside className="warning">目前啟用的 Rules Module 尚有必須先完成的規則裁定；本局已安全暫停。</aside> : null}
    {view.status === 'finalRound' ? <aside className="warning" data-testid="final-round-notice">最終輪已觸發；將完成目前輪次後結算。</aside> : null}
    {error ? <aside className="error">{error.code}：{error.message}</aside> : null}
    <section className="player-summary" data-testid="player-summary"><div><h2>你的公會</h2><span data-testid="human-card-count">手牌 {view.self.hand.length} · 牌庫 {view.self.drawPileCount} · 棄牌 {view.self.discardPile.length}</span></div><div><strong data-testid="phase-status">{view.phase === 'purchase' ? '購買階段' : '準備行動'}</strong><span>道具加成：購買 +{view.self.turnPurchaseBonus}／戰力 +{view.self.turnCombatBonus}</span></div>{view.opponents.map((opponent) => <div key={opponent.id}><h2>{opponent.name}</h2><span>手牌 {opponent.handCount} · 隊伍 {opponent.partyCount} · 棄牌 {opponent.discardCount}</span></div>)}</section>
    <PartyPanel player={view.self} partyLimit={view.partyLimit} definitions={definitions} cardDefinitions={cardDefinitions} presentation={presentation} equipCardId={equipmentCardId} legalEquipCommands={legalEquipCommands} onInspect={inspectCard} />
    <section data-testid="hand"><h2>手牌</h2><div className="card-row">{view.self.hand.map((cardId) => {
      const definition = definitions[cardDefinitions[cardId] ?? ''];
      const exactCommand = legalCommands.find((command): command is Extract<GameCommand, { type: 'PLAY_ADVENTURER' | 'USE_ITEM' }> =>
        (command.type === 'PLAY_ADVENTURER' || command.type === 'USE_ITEM') && command.cardId === cardId);
      const equipmentCommands = legalEquipCommands.filter((command) => command.cardId === cardId);
      const action = exactCommand
        ? commandAction(`${exactCommand.type}:${cardId}`, exactCommand.type === 'PLAY_ADVENTURER' ? '加入隊伍' : '使用道具', exactCommand)
        : equipmentSelectionAction(cardId, equipmentCommands);
      const card = buildCardVisualModel({
        instance: view.cards[cardId],
        definition: definition as CardDefinition | undefined,
        presentation: presentation.resolve(definition?.id ?? cardDefinitions[cardId] ?? ''),
        interactionState: equipmentCardId === cardId ? 'selected' : action ? 'legal' : 'unavailable',
        action,
      });
      return <Card key={cardId} testId={`hand-card-${cardId}`} card={card} onInspect={inspectCard} />;
    })}</div></section>
    <BoardPanel zones={view.zones} targets={view.enemyTargets} definitions={definitions} cards={view.cards} presentation={presentation} legalCommands={legalCommands} onInspect={inspectCard} />
    <LifecycleInteractionDock ref={lifecycleHeadingRef} model={lifecycleInteraction} scopeKey={`${view.gameId}:${view.revision}`} onAction={submitAndClear} />
    <section className="controls"><p ref={interactionFallbackRef} data-testid="interaction-hint" role="status" tabIndex={-1}>{interactionHint}</p><button data-testid="end-phase" className="primary" type="button" disabled={!endPhaseCommand} onClick={() => endPhaseCommand && submitAndClear(endPhaseCommand)}>結束{phaseNames[view.phase]}階段</button>{equipmentCardId ? <button type="button" onClick={() => setEquipmentCardId(undefined)}>取消配戴</button> : null}<button type="button" onClick={restartAndClear}>重新開始</button></section>
    <section className="log"><h2>事件紀錄</h2>{events.length === 0 ? <p>等待你的第一個行動。</p> : events.slice(-12).reverse().map((item) => <p key={item.eventId}>{item.message}</p>)}</section>
    {replayRunner}
    <CardDetailsPanel
      card={currentInspection?.card}
      trigger={inspection?.trigger}
      getFocusFallback={() => lifecyclePending ? lifecycleHeadingRef.current ?? interactionFallbackRef.current ?? appRootRef.current ?? undefined : interactionFallbackRef.current ?? appRootRef.current ?? undefined}
      onClose={closeDetails}
      onAction={runCardAction}
    />
  </main>;
}
