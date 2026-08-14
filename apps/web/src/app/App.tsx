import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameCommand } from '@guildmaster/game-protocol';
import { BoardPanel } from '../features/game/board/BoardPanel.js';
import { ExpeditionEntryScreen } from '../features/game/entry/ExpeditionEntryScreen.js';
import { PartyPanel } from '../features/game/party/PartyPanel.js';
import { ActivityPanel } from '../features/game/table/ActivityPanel.js';
import { CardStateLegend } from '../features/game/table/CardStateLegend.js';
import { GameHeader } from '../features/game/table/GameHeader.js';
import { GameNotices } from '../features/game/table/GameNotices.js';
import { GameResultsScreen } from '../features/game/table/GameResultsScreen.js';
import { GameTableShell } from '../features/game/table/GameTableShell.js';
import { HandPanel } from '../features/game/table/HandPanel.js';
import { PlayerStatusStrip } from '../features/game/table/PlayerStatusStrip.js';
import { ReplayDiagnosticsPanel } from '../features/game/table/ReplayDiagnosticsPanel.js';
import { TurnControlDock } from '../features/game/table/TurnControlDock.js';
import { buildLegalActionSummary } from '../features/game/table/gameplay-feedback.js';
import { buildInteractionHint, phaseDisplayName } from '../features/game/table/phase-copy.js';
import { useLifecycleFocus } from '../features/game/table/use-lifecycle-focus.js';
import { CardDetailsPanel } from '../ui/components/CardDetailsPanel.js';
import { LifecycleInteractionDock } from '../ui/components/LifecycleInteractionDock.js';
import {
  isCardActionCurrent,
  type CardAction,
  type CardVisualViewModel,
} from '../ui/cards/card-visual-model.js';
import { buildLifecycleInteractionModel } from '../ui/lifecycle/lifecycle-interaction-model.js';
import { useGameStore } from '../store/game-store.js';
import { lifecycleCopyResolver, presentationResolver } from './presentation.js';
import { webContentModeOptions, type WebGameSetup } from './ruleset.js';

type CardInspection = {
  gameId: string;
  revision: number;
  card: CardVisualViewModel;
  trigger: HTMLButtonElement;
};

export function App() {
  const {
    view, definitions, bondDefinitions, events, legalCommands, actionPreviews, entrySummary, persistence, error, scoreboard, replayReport, cpu, cpuPaused, cpuSpeed,
    submit, stepCpu, setCpuPaused, setCpuSpeed, restart, loadCurrentReplay, runReplay, clearReplayReport,
  } = useGameStore();
  const [equipmentCardId, setEquipmentCardId] = useState<string>();
  const [inspection, setInspection] = useState<CardInspection>();
  const [hasEnteredGame, setHasEnteredGame] = useState(false);
  const [selectedBondIds, setSelectedBondIds] = useState<string[]>([]);
  const [selectedCompletionBondIds, setSelectedCompletionBondIds] = useState<string[]>([]);
  const appRootRef = useRef<HTMLElement>(null);
  const interactionFallbackRef = useRef<HTMLParagraphElement>(null);
  const lifecycleHeadingRef = useRef<HTMLHeadingElement>(null);
  const cardDefinitions = useMemo(
    () => Object.fromEntries(Object.entries(view.cards).map(([id, card]) => [id, card.definitionId])),
    [view.cards],
  );
  const lifecycleInteraction = useMemo(
    () => buildLifecycleInteractionModel(view, legalCommands, events, lifecycleCopyResolver, (_choiceId, optionId) => {
      const definitionId = view.cards[optionId]?.definitionId;
      return definitionId ? presentationResolver.resolve(definitionId).displayName : undefined;
    }),
    [events, legalCommands, view],
  );
  const lifecyclePending = lifecycleInteraction.kind === 'choice'
    || lifecycleInteraction.kind === 'counter-consent'
    || lifecycleInteraction.kind === 'waiting';
  const interactionHint = buildInteractionHint({
    lifecyclePending,
    status: view.status,
    viewerActive: view.activePlayerId === view.viewerId,
    phase: view.phase,
  });
  const legalActionSummary = buildLegalActionSummary(legalCommands);
  const legalEquipCommands = legalCommands.filter(
    (command): command is Extract<GameCommand, { type: 'EQUIP_ITEM' }> => command.type === 'EQUIP_ITEM',
  );
  const endPhaseCommand = legalCommands.find(
    (command): command is Extract<GameCommand, { type: 'END_PHASE' }> =>
      command.type === 'END_PHASE' && command.phase === view.phase,
  );
  const completeBondCommands = legalCommands.filter(
    (command): command is Extract<GameCommand, { type: 'COMPLETE_BONDS' }> => command.type === 'COMPLETE_BONDS',
  );
  const completableBondIds = [...new Set(completeBondCommands.flatMap(({ bondIds }) => bondIds))];
  const selectedCompleteBondCommand = completeBondCommands.find(({ bondIds }) =>
    bondIds.length === selectedCompletionBondIds.length
    && bondIds.every((bondId) => selectedCompletionBondIds.includes(bondId)),
  );
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
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        (interactionFallbackRef.current ?? appRootRef.current)?.focus();
      });
    });
  };
  const focusGame = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        (interactionFallbackRef.current ?? appRootRef.current)?.focus();
      });
    });
  };
  const continueExpedition = () => {
    setHasEnteredGame(true);
    focusGame();
  };
  const startNewExpedition = (setup: WebGameSetup) => {
    clearTransientUi();
    restart(setup);
    setHasEnteredGame(true);
    focusGame();
  };
  const inspectCard = (card: CardVisualViewModel, trigger: HTMLButtonElement) => {
    setInspection({ gameId: view.gameId, revision: view.revision, card, trigger });
  };
  const runCardAction = (action: CardAction) => {
    if (action.kind === 'select-equipment') {
      setEquipmentCardId(action.equipmentCardId);
      return;
    }
    submitAndClear(action.command);
  };
  const replayDiagnostics = <ReplayDiagnosticsPanel
    report={replayReport}
    loadCurrentReplay={loadCurrentReplay}
    runReplay={runReplay}
    clearReport={clearReplayReport}
  />;

  useLifecycleFocus(hasEnteredGame && lifecyclePending, lifecycleInteraction.key, lifecycleHeadingRef, interactionFallbackRef);
  const cpuNeedsStep = cpu.status === 'ready' && Boolean(cpu.nextActorId);
  useEffect(() => {
    if (!hasEnteredGame || !cpuNeedsStep || cpuPaused || view.status === 'finished') return undefined;
    const delay = { slow: 1200, normal: 600, fast: 150, instant: 10 }[cpuSpeed];
    const timer = window.setTimeout(stepCpu, delay);
    return () => window.clearTimeout(timer);
  }, [cpu.stepKey, cpuNeedsStep, cpuPaused, cpuSpeed, hasEnteredGame, stepCpu, view.status]);
  useEffect(() => { setSelectedBondIds([]); }, [view.bondSetup?.offerId, view.bondSetup?.currentActorId]);
  useEffect(() => { setSelectedCompletionBondIds([]); }, [view.gameId, view.revision, view.activePlayerId]);

  if (!hasEnteredGame) {
    return <ExpeditionEntryScreen
      summary={entrySummary}
      persistence={persistence}
      onContinue={continueExpedition}
      onStartNew={startNewExpedition}
    />;
  }

  if (scoreboard) {
    return <GameResultsScreen
      ref={appRootRef}
      conditionId={view.endState?.conditionId ?? '遊戲結束'}
      viewerId={view.viewerId}
      scoreboard={scoreboard}
      diagnostics={replayDiagnostics}
      notices={<GameNotices status={view.status} persistence={persistence} contentMode={entrySummary.contentMode} helpersEnabled={entrySummary.advancedRules.helpers} error={error} />}
      persistence={persistence}
      onRestart={restartAndClear}
    />;
  }

  return <GameTableShell
    ref={appRootRef}
    header={<GameHeader
      round={view.round}
      phase={view.phase}
      revision={view.revision}
      isViewerActive={view.activePlayerId === view.viewerId}
      persistence={persistence}
      contentLabel={webContentModeOptions[entrySummary.contentMode].label}
    />}
    notices={<GameNotices status={view.status} persistence={persistence} contentMode={entrySummary.contentMode} helpersEnabled={entrySummary.advancedRules.helpers} error={error} />}
    playerStatus={<PlayerStatusStrip
      self={{
        handCount: view.self.hand.length,
        drawPileCount: view.self.drawPileCount,
        discardCount: view.self.discardPile.length,
        turnPurchaseBonus: view.self.turnPurchaseBonus,
        turnCombatBonus: view.self.turnCombatBonus,
      }}
      phase={view.phase}
      opponents={view.opponents}
    />}
    publicTable={<BoardPanel
      zones={view.zones}
      targets={view.enemyTargets}
      definitions={definitions}
      cards={view.cards}
      presentation={presentationResolver}
      legalCommands={legalCommands}
      actionPreviews={actionPreviews}
      previewScope={{ gameId: view.gameId, revision: view.revision, actorId: view.viewerId }}
      onInspect={inspectCard}
    />}
    party={<PartyPanel
      player={view.self}
      partyLimit={view.partyLimit}
      definitions={definitions}
      cardDefinitions={cardDefinitions}
      presentation={presentationResolver}
      equipCardId={equipmentCardId}
      legalEquipCommands={legalEquipCommands}
      onInspect={inspectCard}
    />}
    hand={<HandPanel
      cardIds={view.self.hand}
      definitions={definitions}
      cards={view.cards}
      presentation={presentationResolver}
      legalCommands={legalCommands}
      legalEquipCommands={legalEquipCommands}
      equipmentCardId={equipmentCardId}
      onInspect={inspectCard}
    />}
    interaction={<div className="interaction-rail" data-testid="interaction-rail">
      {view.bondSetup?.offeredBondIds
        ? <section className="bond-setup-panel" aria-labelledby="bond-setup-heading">
            <h2 id="bond-setup-heading">從七張私人羈絆保留五張</h2>
            <div className="bond-choice-grid">{view.bondSetup.offeredBondIds.map((bondId) => {
              const bond = bondDefinitions.find(({ id }) => id === bondId);
              const checked = selectedBondIds.includes(bondId);
              return <label key={bondId}><input type="checkbox" checked={checked} disabled={!checked && selectedBondIds.length >= 5} onChange={() => setSelectedBondIds((current) => checked ? current.filter((id) => id !== bondId) : [...current, bondId])} /><span>{bond?.name ?? bondId} · {bond?.honor ?? 0} 榮譽</span></label>;
            })}</div>
            <button className="primary" type="button" disabled={selectedBondIds.length !== 5} onClick={() => submitAndClear({ type: 'SELECT_BONDS', offerId: view.bondSetup!.offerId, bondIds: selectedBondIds })}>確認保留五張</button>
          </section>
        : null}
      {completableBondIds.length > 0
        ? <section className="bond-setup-panel" aria-labelledby="bond-completion-heading">
            <h2 id="bond-completion-heading">羈絆條件已成立</h2>
            <p>可以完成任意子集合，也可以暫不完成；暫不完成不會保存資格。</p>
            <div className="bond-choice-grid">{completableBondIds.map((bondId) => {
              const bond = bondDefinitions.find(({ id }) => id === bondId);
              const checked = selectedCompletionBondIds.includes(bondId);
              return <label key={bondId}><input type="checkbox" checked={checked} onChange={() => setSelectedCompletionBondIds((current) => checked ? current.filter((id) => id !== bondId) : [...current, bondId])} /><span>{bond?.name ?? bondId} · {bond?.honor ?? 0} 榮譽</span></label>;
            })}</div>
            <button className="primary" type="button" disabled={!selectedCompleteBondCommand} onClick={() => selectedCompleteBondCommand && submitAndClear(selectedCompleteBondCommand)}>完成所選羈絆</button>
          </section>
        : null}
      {entrySummary.contentMode === 'provisional-original-full'
        ? <section className="cpu-controls" aria-label="CPU 控制">
            <div className="controls"><button type="button" onClick={() => setCpuPaused(!cpuPaused)}>{cpuPaused ? '繼續 CPU' : '暫停 CPU'}</button><button type="button" disabled={!cpuNeedsStep || !cpuPaused} onClick={stepCpu}>CPU 單步</button>
              <label>速度 <select value={cpuSpeed} onChange={(event) => setCpuSpeed(event.currentTarget.value as typeof cpuSpeed)}><option value="slow">慢</option><option value="normal">一般</option><option value="fast">快</option><option value="instant">即時</option></select></label></div>
            {cpu.diagnostic ? <p className="error" role="alert">CPU 已安全暫停：{cpu.diagnostic}</p> : null}
            <details><summary>CPU 決策紀錄（{cpu.decisions.length}）</summary><ol>{cpu.decisions.slice(-12).map((decision, index) => <li key={`${decision.revision}-${decision.actorId}-${index}`}>r{decision.revision} · {decision.actorId} · {decision.command.type} · {decision.reasonCode} · {decision.score}</li>)}</ol></details>
          </section>
        : null}
      <LifecycleInteractionDock
        ref={lifecycleHeadingRef}
        model={lifecycleInteraction}
        scopeKey={`${view.gameId}:${view.revision}`}
        onAction={submitAndClear}
      />
      <TurnControlDock
        ref={interactionFallbackRef}
        scopeKey={`${view.gameId}:${view.revision}`}
        interactionHint={interactionHint}
        actionSummary={legalActionSummary}
        phaseName={phaseDisplayName(view.phase)}
        canEndPhase={Boolean(endPhaseCommand)}
        equipmentSelected={Boolean(equipmentCardId)}
        onEndPhase={() => {
          if (endPhaseCommand) submitAndClear(endPhaseCommand);
        }}
        onCancelEquipment={() => setEquipmentCardId(undefined)}
        onRestart={restartAndClear}
      />
      <CardStateLegend />
    </div>}
    activity={<ActivityPanel events={events} diagnostics={replayDiagnostics} />}
    details={<CardDetailsPanel
      card={currentInspection?.card}
      trigger={inspection?.trigger}
      getFocusFallback={() => lifecyclePending
        ? lifecycleHeadingRef.current ?? interactionFallbackRef.current ?? appRootRef.current ?? undefined
        : interactionFallbackRef.current ?? appRootRef.current ?? undefined}
      onClose={() => setInspection(undefined)}
      onAction={runCardAction}
    />}
  />;
}
