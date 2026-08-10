import { useMemo, useRef, useState } from 'react';
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
    view, definitions, events, legalCommands, actionPreviews, entrySummary, persistence, error, scoreboard, replayReport,
    submit, restart, loadCurrentReplay, runReplay, clearReplayReport,
  } = useGameStore();
  const [equipmentCardId, setEquipmentCardId] = useState<string>();
  const [inspection, setInspection] = useState<CardInspection>();
  const [hasEnteredGame, setHasEnteredGame] = useState(false);
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
