import { useMemo, useState } from 'react';
import type { CardDefinition, GameCommand } from '@guildmaster/game-protocol';
import { createPresentationResolver, neutralPlaceholderPresentationPack } from '@guildmaster/presentation-core';
import { BoardPanel } from '../features/game/board/BoardPanel.js';
import { PartyPanel } from '../features/game/party/PartyPanel.js';
import { Card } from '../ui/components/Card.js';
import { useGameStore } from '../store/game-store.js';

const phaseNames = { action1: '行動一', combat: '討伐', action2: '行動二', purchase: '購買', rest: '休息' } as const;

export function App() {
  const { view, definitions, events, legalCommands, error, scoreboard, replayReport, submit, restart, loadCurrentReplay, runReplay, clearReplayReport } = useGameStore();
  const [equipmentCardId, setEquipmentCardId] = useState<string>();
  const [replaySource, setReplaySource] = useState('');
  const presentation = useMemo(() => createPresentationResolver([neutralPlaceholderPresentationPack]), []);
  const cardDefinitions = useMemo(() => Object.fromEntries(Object.entries(view.cards).map(([id, card]) => [id, card.definitionId])), [view.cards]);
  const canAct = view.status === 'playing' || view.status === 'finalRound';
  const isAction = view.phase === 'action1' || view.phase === 'action2';
  const choiceCommands = legalCommands.filter((command): command is Extract<GameCommand, { type: 'RESOLVE_EFFECT_CHOICE' }> => command.type === 'RESOLVE_EFFECT_CHOICE');
  const interactionHint = choiceCommands.length ? '請先完成目前待處理的規則選擇。' : !canAct ? '此對局目前不可操作。' : view.activePlayerId !== view.viewerId ? 'AI 正在行動，請等待你的回合。' : isAction ? '可操作手牌會以可點擊狀態顯示。' : `目前是${phaseNames[view.phase]}階段，行動手牌暫不可用。`;
  const legalPlayIds = new Set(legalCommands.filter((command): command is Extract<GameCommand, { type: 'PLAY_ADVENTURER' }> => command.type === 'PLAY_ADVENTURER').map((command) => command.cardId));
  const legalUseIds = new Set(legalCommands.filter((command): command is Extract<GameCommand, { type: 'USE_ITEM' }> => command.type === 'USE_ITEM').map((command) => command.cardId));
  const legalEquipCommands = legalCommands.filter((command): command is Extract<GameCommand, { type: 'EQUIP_ITEM' }> => command.type === 'EQUIP_ITEM');
  const legalEquipIds = new Set(legalEquipCommands.map((command) => command.cardId));
  const attackableTargetIds = new Set(legalCommands.filter((command): command is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => command.type === 'ATTACK_TARGET').map((command) => command.targetId));
  const buyableCardIds = new Set(legalCommands.filter((command): command is Extract<GameCommand, { type: 'BUY_CARD' }> => command.type === 'BUY_CARD').map((command) => command.cardId));
  const endPhaseCommand = legalCommands.find((command): command is Extract<GameCommand, { type: 'END_PHASE' }> => command.type === 'END_PHASE' && command.phase === view.phase);
  const submitAndClear = (command: GameCommand) => { setEquipmentCardId(undefined); submit(command); };

  if (scoreboard) return <main className="app-shell"><section className="hero"><p className="eyebrow">文字版 MVP</p><h1>遠征結算</h1><p>{view.endState?.conditionId ?? '遊戲結束'}</p></section><section className="scoreboard"><h2>榮譽排名</h2>{scoreboard.map((row) => <div className="score-row" key={row.playerId}><strong>#{row.rank} {row.name}</strong><span>{row.honor} 榮譽</span><small>魔王 {row.defeatedBosses}／魔物 {row.defeatedMonsters}</small></div>)}</section><button className="primary" type="button" onClick={restart}>開啟新遠征</button></main>;

  return <main className="app-shell" data-testid="game-app">
    <header className="hero"><div><p className="eyebrow">原創文字示範牌組 · 單機人機對戰</p><h1>晨星公會</h1><p>第 {view.round} 輪 · {phaseNames[view.phase]}階段</p></div><div className="status"><strong>{view.activePlayerId === view.viewerId ? '你的回合' : 'AI 正在行動'}</strong><span>版本 {view.revision}</span></div></header>
    {view.status === 'pendingOfficialRuling' ? <aside className="warning">公共供應牌庫耗盡的基礎版官方結果尚待確認；本局已安全暫停。</aside> : null}
    {error ? <aside className="error">{error.code}：{error.message}</aside> : null}
    <section className="player-summary" data-testid="player-summary"><div><h2>你的公會</h2><span data-testid="human-card-count">手牌 {view.self.hand.length} · 牌庫 {view.self.drawPileCount} · 棄牌 {view.self.discardPile.length}</span></div><div><strong data-testid="phase-status">{view.phase === 'purchase' ? '購買階段' : '準備行動'}</strong><span>道具加成：購買 +{view.self.turnPurchaseBonus}／戰力 +{view.self.turnCombatBonus}</span></div>{view.opponents.map((opponent) => <div key={opponent.id}><h2>{opponent.name}</h2><span>手牌 {opponent.handCount} · 隊伍 {opponent.partyCount} · 棄牌 {opponent.discardCount}</span></div>)}</section>
    <PartyPanel player={view.self} partyLimit={view.partyLimit} definitions={definitions} cardDefinitions={cardDefinitions} presentation={presentation} equipCardId={equipmentCardId} canEquipTo={(adventurerId) => Boolean(equipmentCardId && legalEquipCommands.some((command) => command.cardId === equipmentCardId && command.adventurerId === adventurerId))} onEquip={(adventurerId) => equipmentCardId && submitAndClear({ type: 'EQUIP_ITEM', cardId: equipmentCardId, adventurerId })} />
    <section data-testid="hand"><h2>手牌</h2><div className="card-row">{view.self.hand.map((cardId) => {
      const definition = definitions[cardDefinitions[cardId] ?? ''];
      const canPlay = isAction && definition?.type === 'adventurer' && legalPlayIds.has(cardId);
      const canUse = isAction && definition?.type === 'item' && legalUseIds.has(cardId);
      const canEquip = isAction && definition?.type === 'equipment' && legalEquipIds.has(cardId);
      const onClick = canPlay ? () => submitAndClear({ type: 'PLAY_ADVENTURER', cardId }) : canUse ? () => submitAndClear({ type: 'USE_ITEM', cardId }) : canEquip ? () => setEquipmentCardId(cardId) : undefined;
      return <Card key={cardId} testId={`hand-card-${cardId}`} instance={view.cards[cardId]} definition={definition as CardDefinition | undefined} presentation={presentation.resolve(definition?.id ?? cardDefinitions[cardId] ?? '')} onClick={onClick} selected={equipmentCardId === cardId} label={canEquip ? '點選後選隊員' : undefined} />;
    })}</div></section>
    <BoardPanel zones={view.zones} targets={view.enemyTargets} definitions={definitions} cards={view.cards} presentation={presentation} attackableTargetIds={attackableTargetIds} buyableCardIds={buyableCardIds} onAttack={(targetId) => submitAndClear({ type: 'ATTACK_TARGET', targetId })} onBuy={(cardId) => submitAndClear({ type: 'BUY_CARD', cardId })} />
    <section className="controls"><p data-testid="interaction-hint" role="status">{interactionHint}</p>{choiceCommands.map((command) => <button key={`${command.executionId}:${command.choiceId}:${command.optionId}`} type="button" onClick={() => submitAndClear(command)}>選擇：{command.optionId}</button>)}<button data-testid="end-phase" className="primary" type="button" disabled={!endPhaseCommand} onClick={() => endPhaseCommand && submitAndClear(endPhaseCommand)}>結束{phaseNames[view.phase]}階段</button>{equipmentCardId ? <button type="button" onClick={() => setEquipmentCardId(undefined)}>取消配戴</button> : null}<button type="button" onClick={restart}>重新開始</button></section>
    <section className="log"><h2>事件紀錄</h2>{events.length === 0 ? <p>等待你的第一個行動。</p> : events.slice(-12).reverse().map((item) => <p key={item.eventId}>{item.message}</p>)}</section>
    <section className="replay-runner" data-testid="replay-runner"><h2>Replay 診斷</h2><p>貼上 versioned Replay JSON；執行不會修改目前對局或本機存檔。</p><textarea aria-label="Replay JSON" value={replaySource} onChange={(event) => setReplaySource(event.target.value)} placeholder="貼上 ReplayBundle JSON" /><div className="controls"><button type="button" onClick={() => { const exported = loadCurrentReplay(); if (exported) setReplaySource(exported); }}>載入目前 Replay</button><button data-testid="run-replay" type="button" onClick={() => runReplay(replaySource)}>執行 Replay</button>{replayReport ? <button type="button" onClick={clearReplayReport}>清除結果</button> : null}</div>{replayReport ? <output data-testid="replay-report" className={replayReport.status === 'completed' ? 'replay-success' : 'replay-failure'}>{replayReport.status === 'completed' ? <><strong>{replayReport.message}</strong><span>commands {replayReport.commandCount} · events {replayReport.eventCount} · revision {replayReport.revision}</span></> : <><strong>{replayReport.reasonCode ?? 'MALFORMED_REPLAY'}：{replayReport.message}</strong>{replayReport.commandIndex !== undefined ? <span>command #{replayReport.commandIndex + 1}{replayReport.commandId ? ` (${replayReport.commandId})` : ''}</span> : null}{replayReport.expectedRevision !== undefined ? <span>revision expected {replayReport.expectedRevision} / actual {replayReport.actualRevision}</span> : null}{replayReport.divergence ? <span>first divergence {replayReport.divergence.path}：expected {JSON.stringify(replayReport.divergence.expected)} / actual {JSON.stringify(replayReport.divergence.actual)}</span> : null}</>}</output> : null}</section>
  </main>;
}
