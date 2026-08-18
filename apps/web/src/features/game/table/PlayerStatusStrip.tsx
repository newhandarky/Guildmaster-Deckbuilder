import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { CardDefinition, CardInstance, Phase, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';

type OpponentSummary = PlayerView['opponents'][number];
type BondDefinition = { id: string; name: string; honor: number };

type SelfSummary = {
  handCount: number;
  drawPileCount: number;
  discardCount: number;
  turnPurchaseBonus: number;
  turnCombatBonus: number;
};

type Props = {
  self: SelfSummary;
  phase: Phase;
  opponents: readonly OpponentSummary[];
  cards: Record<string, CardInstance>;
  definitions: Readonly<Record<string, CardDefinition>>;
  presentation: PresentationResolver;
  bondDefinitions: readonly BondDefinition[];
  suspendDetails?: boolean;
};

const hoverCloseDelayMs = 180;

export function PlayerStatusStrip({ self, phase, opponents, cards, definitions, presentation, bondDefinitions, suspendDetails = false }: Props) {
  const [hoveredId, setHoveredId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const [touchPinnedId, setTouchPinnedId] = useState<string>();
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pointerFocusSuppressedRef = useRef(false);
  const sortedOpponents = useMemo(() => [...opponents].sort((a, b) => a.seatIndex - b.seatIndex), [opponents]);
  const openId = suspendDetails ? undefined : hoveredId ?? focusedId ?? touchPinnedId;
  const open = opponents.find(({ id }) => id === openId);

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = undefined;
  };
  const closeAllDetails = () => {
    clearHoverCloseTimer();
    setHoveredId(undefined);
    setFocusedId(undefined);
    setTouchPinnedId(undefined);
  };

  useEffect(() => {
    if (suspendDetails) {
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
      setHoveredId(undefined);
      setFocusedId(undefined);
      setTouchPinnedId(undefined);
    }
    return () => {
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    };
  }, [suspendDetails]);

  useEffect(() => {
    const markKeyboardInput = () => { pointerFocusSuppressedRef.current = false; };
    window.addEventListener('keydown', markKeyboardInput, true);
    return () => window.removeEventListener('keydown', markKeyboardInput, true);
  }, []);

  const scheduleHoverClose = (opponentId: string) => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredId((current) => current === opponentId ? undefined : current);
      hoverCloseTimerRef.current = undefined;
    }, hoverCloseDelayMs);
  };
  const onClusterBlur = (event: FocusEvent<HTMLDivElement>, opponentId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFocusedId((current) => current === opponentId ? undefined : current);
  };
  const nameFor = (cardId: string) => {
    const definitionId = cards[cardId]?.definitionId ?? '';
    return presentation.resolve(definitionId).displayName || definitions[definitionId]?.name || '公開卡牌';
  };

  return <section className="player-summary" data-testid="player-summary" aria-label="玩家座位資訊">
    <div className="self-seat">
      <h2>你的公會</h2>
      <span data-testid="human-card-count">手牌 {self.handCount} · 牌庫 {self.drawPileCount} · 棄牌 {self.discardCount}</span>
      <strong data-testid="phase-status">{phase === 'purchase' ? '購買階段' : '準備行動'}</strong>
      <span>道具加成：購買 +{self.turnPurchaseBonus}／戰力 +{self.turnCombatBonus}</span>
    </div>
    {sortedOpponents.map((opponent, index) => {
      const expanded = openId === opponent.id;
      return <div
        className={`player-seat-cluster seat-${index}`}
        data-testid={`player-seat-cluster-${opponent.id}`}
        key={opponent.id}
        onPointerEnter={(event) => {
          if (suspendDetails || event.pointerType !== 'mouse') return;
          clearHoverCloseTimer();
          setHoveredId(opponent.id);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') scheduleHoverClose(opponent.id);
        }}
        onBlur={(event) => onClusterBlur(event, opponent.id)}
      >
        <button
          id={`player-seat-${opponent.id}`}
          type="button"
          className={`player-seat${opponent.isActive ? ' player-seat-active' : ''}`}
          aria-expanded={expanded}
          aria-controls={`opponent-${opponent.id}`}
          onPointerDown={(event) => {
            const isTouchPointer = event.pointerType === 'touch' || event.pointerType === 'pen';
            pointerFocusSuppressedRef.current = isTouchPointer || event.pointerType === 'mouse';
            if (isTouchPointer) {
              clearHoverCloseTimer();
              setHoveredId(undefined);
              setFocusedId(undefined);
            }
          }}
          onPointerUp={(event) => {
            if (!suspendDetails && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
              setTouchPinnedId((current) => current === opponent.id ? undefined : opponent.id);
            }
          }}
          onPointerCancel={() => { pointerFocusSuppressedRef.current = false; }}
          onFocus={() => {
            if (suspendDetails || pointerFocusSuppressedRef.current) return;
            setFocusedId(opponent.id);
          }}
        >
          <strong>{opponent.name} · {opponent.kind === 'ai' ? 'CPU' : '真人'}{opponent.isActive ? ' · 行動中' : ''}</strong>
          <span>手牌 {opponent.handCount} · 棄牌 {opponent.discardCount}</span>
          <span>隊伍 {opponent.partyCount} · 公開戰力 {opponent.partyCombat} · 羈絆 {opponent.bonds.length}</span>
        </button>
        {expanded && open ? <aside id={`opponent-${open.id}`} className="opponent-details" role="dialog" aria-label={`${open.name} 的公開資訊`}>
          <button type="button" className="icon-button opponent-details-close" aria-label={`關閉 ${open.name} 的公開資訊`} onClick={closeAllDetails}>×</button>
          <h2>{open.name} 的公開隊伍</h2>
          <p>已擊敗：魔王 {open.defeatedBosses} · 魔物 {open.defeatedMonsters}</p>
          <ol>{open.party.map((member) => <li key={member.adventurerId}><strong>{nameFor(member.adventurerId)}</strong> · 有效戰力 {member.effectiveCombat}{member.equipmentId ? ` · 裝備：${nameFor(member.equipmentId)}` : ''}</li>)}</ol>
          <p>已公開羈絆：{open.bonds.length ? open.bonds.map(({ bondId }) => { const bond = bondDefinitions.find(({ id }) => id === bondId); return `${bond?.name ?? bondId}（${bond?.honor ?? 0} 榮譽）`; }).join('、') : '無'}</p>
          {open.counters.length ? <p>公開 counter：{open.counters.map(({ resourceId, amount }) => `${resourceId} ${amount}`).join('、')}</p> : null}
        </aside> : null}
      </div>;
    })}
  </section>;
}
