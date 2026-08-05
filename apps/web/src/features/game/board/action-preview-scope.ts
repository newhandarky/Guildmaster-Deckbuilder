import type { ActionPreviewItem, ActionPreviewSet } from '@guildmaster/game-protocol';

export type ActionPreviewScope = { gameId: string; revision: number; actorId: string };

export function actionPreviewItemsForScope(actionPreviews: ActionPreviewSet, scope: ActionPreviewScope): readonly ActionPreviewItem[] {
  return actionPreviews.gameId === scope.gameId && actionPreviews.revision === scope.revision && actionPreviews.actorId === scope.actorId
    ? actionPreviews.items
    : [];
}
