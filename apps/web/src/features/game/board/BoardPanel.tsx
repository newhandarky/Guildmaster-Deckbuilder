import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ActionPreviewSet, CardDefinition, CardInstance, EnemyTargetState, GameCommand, ZoneState } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { Card } from '../../../ui/components/Card.js';
import { buildCardVisualModel, commandAction, type CardVisualViewModel } from '../../../ui/cards/card-visual-model.js';
import { actionPreviewItemsForScope, type ActionPreviewScope } from './action-preview-scope.js';
import { hasUnviewedCardIds } from './public-table-tab-state.js';
import { emptySupplyMessage } from './supply-empty-state.js';

type Props = {
  zones: Record<string, ZoneState>;
  targets: Record<string, EnemyTargetState>;
  definitions: Readonly<Record<string, CardDefinition>>;
  cards: Record<string, CardInstance>;
  presentation: PresentationResolver;
  legalCommands: readonly GameCommand[];
  actionPreviews: ActionPreviewSet;
  previewScope: ActionPreviewScope;
  onInspect: (card: CardVisualViewModel, trigger: HTMLButtonElement) => void;
};

type PublicTableTab = 'encounter' | 'tavern';

const publicTableTabs: readonly PublicTableTab[] = ['encounter', 'tavern'];

function definitionFor(cards: Props['cards'], definitions: Props['definitions'], cardId: string): CardDefinition | undefined { return definitions[cards[cardId]?.definitionId ?? '']; }

export function BoardPanel({ zones, targets, definitions, cards, presentation, legalCommands, actionPreviews, previewScope, onInspect }: Props) {
  const [activeTab, setActiveTab] = useState<PublicTableTab>('encounter');
  const tabIdPrefix = useId();
  const tabRefs = useRef<Record<PublicTableTab, HTMLButtonElement | undefined>>({ encounter: undefined, tavern: undefined });
  const [viewedCardIds, setViewedCardIds] = useState<Partial<Record<PublicTableTab, readonly string[]>>>({});
  const cardsIn = (zoneId: string) => zones[zoneId]?.cardIds ?? [];
  const currentActionPreviews = actionPreviewItemsForScope(actionPreviews, previewScope);
  const availableTargets = new Map(
    Object.values(targets)
      .filter((target) => target.status === 'available')
      .map((target) => [target.cardInstanceId, target]),
  );
  const helperZone = zones['base:helper-active'];
  const helperCardId = helperZone?.cardIds[0];
  const helperDefinition = helperCardId ? definitionFor(cards, definitions, helperCardId) : undefined;
  const helperCard = helperCardId ? buildCardVisualModel({
    instance: cards[helperCardId],
    definition: helperDefinition,
    presentation: presentation.resolve(helperDefinition?.id ?? cards[helperCardId]?.definitionId ?? ''),
    interactionState: 'unavailable',
  }) : undefined;
  const tabCardIds = useMemo<Record<PublicTableTab, readonly string[]>>(() => ({
    encounter: ['base:helper-active', 'base:boss-row', 'base:monster-row'].flatMap((zoneId) => zones[zoneId]?.cardIds ?? []),
    tavern: ['base:adventurer-row', 'base:item-row'].flatMap((zoneId) => zones[zoneId]?.cardIds ?? []),
  }), [zones]);
  useEffect(() => {
    const activeIds = tabCardIds[activeTab];
    setViewedCardIds((current) => {
      const previous = current[activeTab];
      return previous?.length === activeIds.length && previous.every((cardId, index) => cardId === activeIds[index])
        ? current
        : { ...current, [activeTab]: [...activeIds] };
    });
  }, [activeTab, tabCardIds]);
  const hasNewCards = (tab: PublicTableTab) => {
    return hasUnviewedCardIds(viewedCardIds[tab], tabCardIds[tab]);
  };
  const actionableCount = (ids: readonly string[], action: 'attack' | 'buy') => ids.filter((id) => {
    if (action === 'attack') return availableTargets.has(id) && legalCommands.some((command) => command.type === 'ATTACK_TARGET' && command.targetId === availableTargets.get(id)?.targetId);
    return legalCommands.some((command) => command.type === 'BUY_CARD' && command.cardId === id);
  }).length;
  const tabSummary = (tab: PublicTableTab) => {
    const isEncounter = tab === 'encounter';
    const actionable = isEncounter
      ? actionableCount([...cardsIn('base:boss-row'), ...cardsIn('base:monster-row')], 'attack')
      : actionableCount([...cardsIn('base:adventurer-row'), ...cardsIn('base:item-row')], 'buy');
    const deckCount = isEncounter
      ? cardsIn('base:boss-deck').length + cardsIn('base:monster-deck').length
      : cardsIn('base:adventurer-deck').length + cardsIn('base:item-deck').length;
    return `可作業 ${actionable} 張，牌庫 ${deckCount} 張${hasNewCards(tab) ? '，有新卡' : ''}`;
  };
  const selectTab = (tab: PublicTableTab) => {
    setActiveTab(tab);
    setViewedCardIds((current) => ({ ...current, [tab]: [...tabCardIds[tab]] }));
    tabRefs.current[tab]?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: PublicTableTab) => {
    const currentIndex = publicTableTabs.indexOf(currentTab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? publicTableTabs.length - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? (currentIndex + 1) % publicTableTabs.length
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (currentIndex + publicTableTabs.length - 1) % publicTableTabs.length
            : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(publicTableTabs[nextIndex]!);
  };
  const renderRow = (zoneId: string, title: string, ids: readonly string[], action: 'attack' | 'buy') => {
    const emptyMessage = emptySupplyMessage(zoneId, ids.length);
    return <section className="board-row" data-zone-id={zoneId}>
      <h3>{title}</h3>
      <div className="card-row" aria-label={`${title}卡片`}>{ids.map((id) => {
      const target = availableTargets.get(id);
      const definition = definitionFor(cards, definitions, id);
      const command = action === 'attack'
        ? legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'ATTACK_TARGET' }> => candidate.type === 'ATTACK_TARGET' && candidate.targetId === target?.targetId)
        : legalCommands.find((candidate): candidate is Extract<GameCommand, { type: 'BUY_CARD' }> => candidate.type === 'BUY_CARD' && candidate.cardId === id);
      const cardAction = command
        ? commandAction(`${command.type}:${action === 'attack' ? target?.targetId : id}`, action === 'attack' ? '討伐' : definition?.type === 'adventurer' ? '招募' : '購買', command)
        : undefined;
      const actionPreview = command?.type === 'ATTACK_TARGET'
        ? currentActionPreviews.find((preview) => preview.kind === 'attack' && preview.targetId === command.targetId)
        : command?.type === 'BUY_CARD'
          ? currentActionPreviews.find((preview) => preview.kind === 'purchase' && preview.cardId === command.cardId)
          : undefined;
      const card = buildCardVisualModel({
        instance: cards[id],
        definition,
        presentation: presentation.resolve(definition?.id ?? cards[id]?.definitionId ?? ''),
        interactionState: cardAction ? 'legal' : 'unavailable',
        action: cardAction,
        actionPreview,
      });
      return <Card key={id} card={card} onInspect={onInspect} />;
    })}</div>
      {emptyMessage ? <p className="supply-empty-state">{emptyMessage}</p> : null}
    </section>;
  };
  const encounterPanelId = `${tabIdPrefix}-encounter-panel`;
  const tavernPanelId = `${tabIdPrefix}-tavern-panel`;
  return <section className="public-table-grid" data-testid="public-table" aria-label="公共牌桌">
    <div className="public-table-tabs" role="tablist" aria-label="公共牌桌區域">
      <button ref={(element) => { tabRefs.current.encounter = element ?? undefined; }} id={`${tabIdPrefix}-encounter-tab`} type="button" role="tab" aria-selected={activeTab === 'encounter'} aria-controls={encounterPanelId} tabIndex={activeTab === 'encounter' ? 0 : -1} onClick={() => selectTab('encounter')} onKeyDown={(event) => onTabKeyDown(event, 'encounter')}>
        <span>遭遇區</span><small>{tabSummary('encounter')}</small>
      </button>
      <button ref={(element) => { tabRefs.current.tavern = element ?? undefined; }} id={`${tabIdPrefix}-tavern-tab`} type="button" role="tab" aria-selected={activeTab === 'tavern'} aria-controls={tavernPanelId} tabIndex={activeTab === 'tavern' ? 0 : -1} onClick={() => selectTab('tavern')} onKeyDown={(event) => onTabKeyDown(event, 'tavern')}>
        <span>酒館區</span><small>{tabSummary('tavern')}</small>
      </button>
    </div>
    <div id={encounterPanelId} className="table-area encounter-area" data-testid="encounter-area" role="tabpanel" aria-labelledby={`${tabIdPrefix}-encounter-tab`} hidden={activeTab !== 'encounter'}>
      <h2 className="area-title">公共遭遇區</h2>
      {helperZone
        ? <section className="board-row helper-panel" data-testid="helper-panel" data-zone-id="base:helper-active" aria-labelledby="helper-panel-title">
            <h3 id="helper-panel-title">目前協助者</h3>
            {helperCard
              ? <div className="card-row" aria-label="目前協助者卡片"><Card card={helperCard} onInspect={onInspect} /></div>
              : <p>目前沒有協助者在場。</p>}
            <p className="helper-retired-count">已離場 {cardsIn('base:helper-retired').length} 張</p>
          </section>
        : null}
      {renderRow('base:boss-row', `魔王（牌庫 ${cardsIn('base:boss-deck').length}）`, cardsIn('base:boss-row'), 'attack')}
      {renderRow('base:monster-row', `魔物區（牌庫 ${cardsIn('base:monster-deck').length}）`, cardsIn('base:monster-row'), 'attack')}
    </div>
    <div id={tavernPanelId} className="table-area tavern-area" data-testid="tavern-area" role="tabpanel" aria-labelledby={`${tabIdPrefix}-tavern-tab`} hidden={activeTab !== 'tavern'}>
      <h2 className="area-title">酒館供應區</h2>
      {renderRow('base:adventurer-row', `招募區（牌庫 ${cardsIn('base:adventurer-deck').length}）`, cardsIn('base:adventurer-row'), 'buy')}
      {renderRow('base:item-row', `商店（牌庫 ${cardsIn('base:item-deck').length}）`, cardsIn('base:item-row'), 'buy')}
    </div>
  </section>;
}
