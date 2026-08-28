import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CpuSpeed } from '../../store/game-store.js';
import { diffPublicCardZones, orderTransitionsByCommittedEvents } from './card-zone-projection.js';
import type { PresentationTransitionBatch } from './types.js';

type Snapshot = { rect: DOMRect; clone: HTMLElement };

const durationScale: Record<CpuSpeed, number> = { slow: 1.35, normal: 1, fast: .4, instant: 0 };
const maximumAnimatedCards = 12;

function visibleCardElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-card-instance-id]'))
    .filter((element) => element.isConnected && element.getClientRects().length > 0);
}

function capture(): Map<string, Snapshot> {
  return new Map(visibleCardElements().flatMap((element) => {
    const id = element.dataset.cardInstanceId;
    return id ? [[id, { rect: element.getBoundingClientRect(), clone: element.cloneNode(true) as HTMLElement }]] : [];
  }));
}

function zoneElement(zoneId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-motion-zone]'))
    .find((element) => element.dataset.motionZone === zoneId);
}

function targetTransform(from: DOMRect, target: DOMRect): string {
  const dx = target.left + target.width / 2 - (from.left + from.width / 2);
  const dy = target.top + target.height / 2 - (from.top + from.height / 2);
  const scale = Math.min(1, Math.max(.35, target.width / Math.max(1, from.width)));
  return `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
}

export function usePresentationMotion(
  batches: readonly PresentationTransitionBatch[],
  gameId: string,
  cpuSpeed: CpuSpeed,
  acknowledge: (batchId: string) => void,
) {
  const snapshotsRef = useRef(new Map<string, Snapshot>());
  const processingRef = useRef<string>();
  const animationsRef = useRef(new Set<Animation>());
  const ghostLayerRef = useRef<HTMLDivElement>();
  const generationRef = useRef(0);
  const eventIdsRef = useRef(new Set<string>());
  const gameIdRef = useRef(gameId);
  const [busy, setBusy] = useState(false);

  const finish = useCallback(() => {
    generationRef.current += 1;
    for (const animation of animationsRef.current) {
      animation.finish();
      animation.cancel();
    }
    animationsRef.current.clear();
    ghostLayerRef.current?.replaceChildren();
    processingRef.current = undefined;
    setBusy(false);
  }, []);

  useLayoutEffect(() => {
    if (gameIdRef.current !== gameId) {
      finish();
      snapshotsRef.current = capture();
      gameIdRef.current = gameId;
      eventIdsRef.current.clear();
    }
    const batch = batches[0];
    if (!batch) {
      snapshotsRef.current = capture();
      return;
    }
    if (processingRef.current) return;
    processingRef.current = batch.batchId;
    const unseenEventIds = batch.events.map(({ eventId }) => eventId).filter((eventId) => !eventIdsRef.current.has(eventId));
    if (batch.events.length > 0 && unseenEventIds.length === 0) {
      processingRef.current = undefined;
      acknowledge(batch.batchId);
      return;
    }
    for (const eventId of unseenEventIds) eventIdsRef.current.add(eventId);
    if (eventIdsRef.current.size > 240) eventIdsRef.current = new Set([...eventIdsRef.current].slice(-120));
    const generation = ++generationRef.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scale = batch.source === 'cpu' ? durationScale[cpuSpeed] : 1;
    if (reduced || scale === 0) {
      processingRef.current = undefined;
      snapshotsRef.current = capture();
      acknowledge(batch.batchId);
      return;
    }

    setBusy(true);
    const current = new Map(visibleCardElements().flatMap((element) => {
      const id = element.dataset.cardInstanceId;
      return id ? [[id, element]] : [];
    }));
    const constrained = window.matchMedia('(max-width: 480px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    const transitions = orderTransitionsByCommittedEvents(diffPublicCardZones(batch.before, batch.after), batch.events).slice(0, constrained ? 8 : maximumAnimatedCards);
    let ghostLayer = ghostLayerRef.current;
    if (!ghostLayer) {
      ghostLayer = document.createElement('div');
      ghostLayer.className = 'motion-ghost-layer';
      ghostLayer.setAttribute('aria-hidden', 'true');
      document.body.append(ghostLayer);
      ghostLayerRef.current = ghostLayer;
    }
    const running: Animation[] = [];
    transitions.forEach((transition, index) => {
      const delay = Math.min(index * 36, 180) * scale;
      const previous = snapshotsRef.current.get(transition.cardId);
      const destination = current.get(transition.cardId);
      if (previous && destination) {
        const nextRect = destination.getBoundingClientRect();
        const dx = previous.rect.left - nextRect.left;
        const dy = previous.rect.top - nextRect.top;
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          running.push(destination.animate(
            constrained
              ? [{ opacity: .45 }, { opacity: 1 }]
              : [{ transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: .82 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }],
            { duration: 320 * scale, delay, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
          ));
        }
        return;
      }
      if (!previous && destination) {
        const drawAnchor = !constrained && transition.to === 'self:hand' ? zoneElement('self:draw') : undefined;
        if (drawAnchor) {
          const destinationRect = destination.getBoundingClientRect();
          const anchorRect = drawAnchor.getBoundingClientRect();
          const ghost = document.createElement('div');
          ghost.className = 'motion-card-back-ghost';
          Object.assign(ghost.style, { left: `${anchorRect.left + anchorRect.width / 2 - destinationRect.width / 2}px`, top: `${anchorRect.top + anchorRect.height / 2 - destinationRect.height / 2}px`, width: `${destinationRect.width}px`, height: `${destinationRect.height}px` });
          ghostLayer!.append(ghost);
          running.push(ghost.animate(
            [{ transform: 'translate3d(0, 0, 0)', opacity: .9 }, { transform: targetTransform(ghost.getBoundingClientRect(), destinationRect), opacity: .2 }],
            { duration: 320 * scale, delay, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
          ));
          running.push(destination.animate(
            [{ transform: 'scaleX(.08)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }],
            { duration: 140 * scale, delay: delay + 220 * scale, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
          ));
          return;
        }
        running.push(destination.animate(
          constrained
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ transform: 'scaleX(.08) translateY(-8px)', opacity: 0 }, { transform: 'scaleX(1) translateY(0)', opacity: 1 }],
          { duration: 220 * scale, delay, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
        ));
        return;
      }
      if (!previous) return;
      const ghost = previous.clone;
      ghost.classList.add('motion-card-ghost');
      ghost.removeAttribute('data-card-instance-id');
      ghost.removeAttribute('data-testid');
      ghost.tabIndex = -1;
      if (ghost instanceof HTMLButtonElement) ghost.disabled = true;
      for (const control of ghost.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]')) control.tabIndex = -1;
      Object.assign(ghost.style, { left: `${previous.rect.left}px`, top: `${previous.rect.top}px`, width: `${previous.rect.width}px`, height: `${previous.rect.height}px` });
      ghostLayer!.append(ghost);
      const target = transition.to ? zoneElement(transition.to)?.getBoundingClientRect() : undefined;
      running.push(ghost.animate(
        target && !constrained
          ? [{ transform: 'translate3d(0, 0, 0)', opacity: .95 }, { transform: targetTransform(previous.rect, target), opacity: .15 }]
          : constrained ? [{ opacity: .8 }, { opacity: 0 }] : [{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(.72)', opacity: 0 }],
        { duration: 320 * scale, delay, easing: target && !constrained ? 'cubic-bezier(.22, 1,.36, 1)' : 'cubic-bezier(.4, 0, 1, 1)', fill: 'both' },
      ));
    });
    for (const animation of running) animationsRef.current.add(animation);
    const completion = running.length
      ? Promise.allSettled(running.map((animation) => animation.finished))
      : Promise.resolve([]);
    void completion.then(() => {
      if (generationRef.current !== generation) return;
      for (const animation of running) {
        animation.cancel();
        animationsRef.current.delete(animation);
      }
      ghostLayerRef.current?.replaceChildren();
      snapshotsRef.current = capture();
      processingRef.current = undefined;
      setBusy(false);
      acknowledge(batch.batchId);
    });
  }, [acknowledge, batches, cpuSpeed, finish, gameId]);

  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current) animation.cancel();
    animationsRef.current.clear();
    ghostLayerRef.current?.remove();
    ghostLayerRef.current = undefined;
  }, []);

  const skip = useCallback(() => {
    const batchIds = batches.map(({ batchId }) => batchId);
    finish();
    snapshotsRef.current = capture();
    for (const batchId of batchIds) acknowledge(batchId);
  }, [acknowledge, batches, finish]);

  return { busy, skip };
}
