import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameCommand } from '@guildmaster/game-protocol';
import { BoardPanel } from '../features/game/board/BoardPanel.js';
import { BondCompletionDock } from '../features/game/bonds/BondCompletionDock.js';
import { BondPanel } from '../features/game/bonds/BondPanel.js';
import { BondSetupPanel } from '../features/game/bonds/BondSetupPanel.js';
import { ExpeditionEntryScreen } from '../features/game/entry/ExpeditionEntryScreen.js';
import { PartyPanel } from '../features/game/party/PartyPanel.js';
import { ActivityPanel } from '../features/game/table/ActivityPanel.js';
import { CardStateLegend } from '../features/game/table/CardStateLegend.js';
import { GameHeader } from '../features/game/table/GameHeader.js';
import { GameNotices } from '../features/game/table/GameNotices.js';
import { GameResultsScreen } from '../features/game/table/GameResultsScreen.js';
import { GameTableShell } from '../features/game/table/GameTableShell.js';
import { HandPanel } from '../features/game/table/HandPanel.js';
import { LatestEventStatus } from '../features/game/table/LatestEventStatus.js';
import { PlayerStatusStrip } from '../features/game/table/PlayerStatusStrip.js';
import { ReplayDiagnosticsPanel } from '../features/game/table/ReplayDiagnosticsPanel.js';
import { RestartControl } from '../features/game/table/RestartControl.js';
import { TurnControlDock } from '../features/game/table/TurnControlDock.js';
import { UtilityDrawer, type UtilityDrawerSection } from '../features/game/table/UtilityDrawer.js';
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
  const bondSetupHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousCompletableBondCountRef = useRef(0);
  const cardDefinitions = useMemo(
    () => Object.fromEntries(Object.entries(view.cards).map(([id, card]) => [id, card.definitionId])),
    [view.cards],
  );
  const displayedBondDefinitions = useMemo(() => bondDefinitions.map((bond) => {
    const copy = presentationResolver.resolve(bond.id);
    const hasPresentationCopy = copy.source === 'pack';
    return {
      id: bond.id,
      name: hasPresentationCopy ? copy.displayName : bond.name,
      honor: bond.honor,
      conditionSummary: hasPresentationCopy
        ? copy.shortDisplayText
        : bond.requiredBosses === 99 ? '依 Rules Module 的權威條件完成' : `擊敗 ${bond.requiredBosses} 名魔王`,
      detailDescription: hasPresentationCopy
        ? copy.detailDisplayText
        : bond.requiredBosses === 99 ? '完成條件由本局 Rules Module 判定。' : `擊敗 ${bond.requiredBosses} 名魔王即可完成。`,
    };
  }), [bondDefinitions]);
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
  const bondSetupOfferId = view.bondSetup?.offerId;
  const bondSetupActorId = view.bondSetup?.currentActorId;
  const hasBondSetupOffer = Boolean(view.bondSetup?.offeredBondIds);
  const interactionHint = buildInteractionHint({
    lifecyclePending,
    status: view.status,
    viewerActive: view.activePlayerId === view.viewerId,
    phase: view.phase,
  });
  const legalActionSummary = buildLegalActionSummary(legalCommands);
  const legalEquipCommands = legalCommands.filter(
    (command): command is Extract<GameCommand, { type: 'EQUIP_ITEM' | 'ATTACH_CARD' }> => command.type === 'EQUIP_ITEM' || command.type === 'ATTACH_CARD',
  );
  const endPhaseCommand = legalCommands.find(
    (command): command is Extract<GameCommand, { type: 'END_PHASE' }> =>
      command.type === 'END_PHASE' && command.phase === view.phase,
  );
  const completeBondCommands = legalCommands.filter(
    (command): command is Extract<GameCommand, { type: 'COMPLETE_BONDS' }> => command.type === 'COMPLETE_BONDS',
  );
  const completableBondIds = [...new Set(completeBondCommands.flatMap(({ bondIds }) => bondIds))];
  const completableBondKey = completableBondIds.join('|');
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
        (bondSetupHeadingRef.current ?? lifecycleHeadingRef.current ?? interactionFallbackRef.current ?? appRootRef.current)?.focus();
      });
    });
  };
  const focusGame = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        (bondSetupHeadingRef.current ?? lifecycleHeadingRef.current ?? interactionFallbackRef.current ?? appRootRef.current)?.focus();
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
    if (action.kind === 'action-menu') return;
    if (action.kind === 'select-equipment') {
      setEquipmentCardId(action.equipmentCardId);
      return;
    }
    submitAndClear(action.command);
  };
  const cpuNeedsStep = cpu.status === 'ready' && Boolean(cpu.nextActorId);
  const replayDiagnostics = <ReplayDiagnosticsPanel
    report={replayReport}
    loadCurrentReplay={loadCurrentReplay}
    runReplay={runReplay}
    clearReport={clearReplayReport}
  />;
  const cpuTools = entrySummary.contentMode === 'provisional-original-full' || entrySummary.contentMode === 'custom-adventurers-full'
    ? <section className="cpu-controls" aria-label="CPU 控制">
        <div className="controls"><button type="button" onClick={() => setCpuPaused(!cpuPaused)}>{cpuPaused ? '繼續 CPU' : '暫停 CPU'}</button><button type="button" disabled={!cpuNeedsStep || !cpuPaused} onClick={stepCpu}>CPU 單步</button>
          <label>速度 <select value={cpuSpeed} onChange={(event) => setCpuSpeed(event.currentTarget.value as typeof cpuSpeed)}><option value="slow">慢</option><option value="normal">一般</option><option value="fast">快</option><option value="instant">即時</option></select></label></div>
        {cpu.diagnostic ? <p className="error" role="alert">CPU 已安全暫停：{cpu.diagnostic}</p> : null}
        <details><summary>CPU 決策紀錄（{cpu.decisions.length}）</summary><ol>{cpu.decisions.slice(-12).map((decision, index) => <li key={`${decision.revision}-${decision.actorId}-${index}`}>r{decision.revision} · {decision.actorId} · {decision.command.type} · {decision.reasonCode} · {decision.score}</li>)}</ol></details>
      </section>
    : <p>目前模式沒有 CPU 控制工具。</p>;
  const utilitySections: readonly UtilityDrawerSection[] = [
    { id: 'events', label: '事件', content: <ActivityPanel events={events} /> },
    { id: 'cpu', label: 'CPU', content: cpuTools },
    { id: 'more', label: '更多', content: <div className="more-tools">
      <RestartControl scopeKey={`${view.gameId}:${view.revision}`} onRestart={restartAndClear} />
      <CardStateLegend />
      {replayDiagnostics}
    </div> },
  ];

  useLifecycleFocus(hasEnteredGame && lifecyclePending, lifecycleInteraction.key, lifecycleHeadingRef, interactionFallbackRef);
  useEffect(() => {
    if (!hasEnteredGame || !cpuNeedsStep || cpuPaused || view.status === 'finished') return undefined;
    const delay = { slow: 1200, normal: 600, fast: 150, instant: 10 }[cpuSpeed];
    const timer = window.setTimeout(stepCpu, delay);
    return () => window.clearTimeout(timer);
  }, [cpu.stepKey, cpuNeedsStep, cpuPaused, cpuSpeed, hasEnteredGame, stepCpu, view.status]);
  useEffect(() => {
    setSelectedBondIds([]);
    if (hasEnteredGame && hasBondSetupOffer) {
      window.requestAnimationFrame(() => bondSetupHeadingRef.current?.focus());
    }
  }, [bondSetupActorId, bondSetupOfferId, hasBondSetupOffer, hasEnteredGame]);
  useEffect(() => { setSelectedCompletionBondIds([]); }, [completableBondKey, view.gameId]);
  useEffect(() => {
    if (previousCompletableBondCountRef.current > 0 && completableBondIds.length === 0) {
      window.requestAnimationFrame(() => interactionFallbackRef.current?.focus());
    }
    previousCompletableBondCountRef.current = completableBondIds.length;
  }, [completableBondIds.length]);

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
        completedBondCount: view.self.bonds.filter(({ completed }) => completed).length,
        bondCount: view.self.bonds.length,
      }}
      phase={view.phase}
      opponents={view.opponents}
      cards={view.cards}
      definitions={definitions}
      presentation={presentationResolver}
      bondDefinitions={displayedBondDefinitions}
      suspendDetails={lifecyclePending}
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
    party={<><PartyPanel
      player={view.self}
      partyLimit={view.partyLimit}
      definitions={definitions}
      cardDefinitions={cardDefinitions}
      presentation={presentationResolver}
      equipCardId={equipmentCardId}
      legalEquipCommands={legalEquipCommands}
      onInspect={inspectCard}
      onCommand={submitAndClear}
    /><BondPanel bonds={view.self.bonds} evaluations={view.bondEvaluations} definitions={displayedBondDefinitions} completableBondIds={completableBondIds} /></>}
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
        ? <BondSetupPanel
            ref={bondSetupHeadingRef}
            bonds={view.bondSetup.offeredBondIds.map((bondId) => displayedBondDefinitions.find(({ id }) => id === bondId) ?? {
              id: bondId,
              name: bondId,
              honor: 0,
              conditionSummary: '尚未提供條件摘要',
              detailDescription: '尚未提供完整規則說明。',
            })}
            selectedBondIds={selectedBondIds}
            onToggle={(bondId) => setSelectedBondIds((current) => current.includes(bondId) ? current.filter((id) => id !== bondId) : [...current, bondId])}
            onConfirm={() => submitAndClear({ type: 'SELECT_BONDS', offerId: view.bondSetup!.offerId, bondIds: selectedBondIds })}
          />
        : null}
      {completableBondIds.length > 0
        ? <BondCompletionDock
            bondIds={completableBondIds}
            definitions={displayedBondDefinitions}
            selectedBondIds={selectedCompletionBondIds}
            canComplete={Boolean(selectedCompleteBondCommand)}
            onToggle={(bondId) => setSelectedCompletionBondIds((current) => current.includes(bondId) ? current.filter((id) => id !== bondId) : [...current, bondId])}
            onComplete={() => selectedCompleteBondCommand && submitAndClear(selectedCompleteBondCommand)}
          />
        : null}
      <LifecycleInteractionDock
        ref={lifecycleHeadingRef}
        model={lifecycleInteraction}
        scopeKey={`${view.gameId}:${view.revision}`}
        onAction={submitAndClear}
      />
      <TurnControlDock
        ref={interactionFallbackRef}
        interactionHint={interactionHint}
        actionSummary={legalActionSummary}
        phaseName={phaseDisplayName(view.phase)}
        canEndPhase={Boolean(endPhaseCommand)}
        equipmentSelected={Boolean(equipmentCardId)}
        purchaseBonus={view.self.turnPurchaseBonus}
        combatBonus={view.self.turnCombatBonus}
        latestEventStatus={<LatestEventStatus event={events.at(-1)} />}
        onEndPhase={() => {
          if (endPhaseCommand) submitAndClear(endPhaseCommand);
        }}
        onCancelEquipment={() => setEquipmentCardId(undefined)}
      />
    </div>}
    utilities={<UtilityDrawer sections={utilitySections} autoOpenId={cpu.diagnostic ? 'cpu' : undefined} suspended={lifecyclePending} />}
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
