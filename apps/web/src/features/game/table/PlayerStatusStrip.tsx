import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { CardDefinition, CardInstance, Phase, PlayerView } from '@guildmaster/game-protocol';
import type { PresentationResolver } from '@guildmaster/presentation-core';
import { CompactPlayerSummary } from './CompactPlayerSummary.js';
import { PlayerPublicDetails } from './PlayerPublicDetails.js';

type OpponentSummary = PlayerView['opponents'][number];
type BondDefinition = { id: string; name: string; honor: number; conditionSummary: string };

type SelfSummary = {
  handCount: number;
  drawPileCount: number;
  discardCount: number;
  turnPurchaseBonus: number;
  turnCombatBonus: number;
  completedBondCount: number;
  bondCount: number;
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
  const seatRefs = useRef(new Map<string, HTMLButtonElement>());
  const sortedOpponents = useMemo(() => [...opponents].sort((a, b) => a.seatIndex - b.seatIndex), [opponents]);
  const openId = suspendDetails ? undefined : hoveredId ?? focusedId ?? touchPinnedId;
  const open = opponents.find(({ id }) => id === openId);

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = undefined;
  };
  const closeAllDetails = (restoreFocusId?: string) => {
    clearHoverCloseTimer();
    setHoveredId(undefined);
    setFocusedId(undefined);
    setTouchPinnedId(undefined);
    if (restoreFocusId) {
      pointerFocusSuppressedRef.current = true;
      window.requestAnimationFrame(() => {
        seatRefs.current.get(restoreFocusId)?.focus();
        pointerFocusSuppressedRef.current = false;
      });
    }
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
  return <section className="player-summary" data-testid="player-summary" aria-label="玩家座位資訊">
    <div className="self-seat">
      <h2>你的公會</h2>
      <span data-testid="human-card-count"><span data-motion-zone="self:hand">手牌 {self.handCount}</span> · <span data-motion-zone="self:draw">牌庫 {self.drawPileCount}</span> · <span data-motion-zone="self:discard">棄牌 {self.discardCount}</span></span>
      <strong data-testid="phase-status">{phase === 'purchase' ? '購買階段' : '準備行動'}</strong>
      <span>道具加成：購買 +{self.turnPurchaseBonus}／戰力 +{self.turnCombatBonus}</span>
      <span>羈絆 {self.completedBondCount}/{self.bondCount}</span>
    </div>
    {sortedOpponents.map((opponent, index) => {
      const expanded = openId === opponent.id;
      return <div
        className={`player-seat-cluster seat-${index}`}
        data-motion-zone={`opponent:${opponent.id}:party`}
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
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !expanded) return;
          event.preventDefault();
          closeAllDetails(opponent.id);
        }}
      >
        <button
          ref={(node) => {
            if (node) seatRefs.current.set(opponent.id, node);
            else seatRefs.current.delete(opponent.id);
          }}
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
          <CompactPlayerSummary opponent={opponent} expanded={expanded} />
        </button>
        {expanded && open ? <PlayerPublicDetails opponent={open} cards={cards} definitions={definitions} presentation={presentation} bondDefinitions={bondDefinitions} onClose={() => closeAllDetails(opponent.id)} /> : null}
      </div>;
    })}
  </section>;
}
