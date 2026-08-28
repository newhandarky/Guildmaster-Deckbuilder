import type { SessionUpdate } from '../../adapters/game-session.js';
import type { PresentationTransitionBatch } from './types.js';

export function createPresentationTransitionBatch(
  before: SessionUpdate['view'],
  update: SessionUpdate,
  source: PresentationTransitionBatch['source'],
  batchId: string,
): PresentationTransitionBatch | undefined {
  if (update.error || update.committedEvents.length === 0 || before.gameId !== update.view.gameId) return undefined;
  return {
    batchId,
    gameId: update.view.gameId,
    fromRevision: before.revision,
    toRevision: update.view.revision,
    source,
    events: structuredClone(update.committedEvents),
    before: structuredClone(before),
    after: structuredClone(update.view),
  };
}

export function appendPresentationBatch(
  queue: readonly PresentationTransitionBatch[],
  batch: PresentationTransitionBatch,
  maximum = 6,
): readonly PresentationTransitionBatch[] {
  if (queue.some(({ batchId }) => batchId === batch.batchId)) return queue;
  const sameGame = queue.filter(({ gameId }) => gameId === batch.gameId);
  if (sameGame.length >= maximum) return [batch];
  return [...sameGame, batch].slice(-maximum);
}
