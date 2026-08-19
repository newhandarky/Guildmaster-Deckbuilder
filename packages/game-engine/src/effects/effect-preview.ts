import type { EffectCardLocation, EffectContext, EffectNode, EffectSelectableCardSource, GameState } from '@guildmaster/game-protocol';
import { resolveEffectPlayerId, resolveSelectableCardSource, sourceLocations } from './effect-choice-resolution.js';

export type EffectPreviewUncertainty = { usesRandomness: boolean; observesHiddenInformation: boolean };
const none = (): EffectPreviewUncertainty => ({ usesRandomness: false, observesHiddenInformation: false });
const merge = (values: readonly EffectPreviewUncertainty[]): EffectPreviewUncertainty => values.reduce((result, value) => ({ usesRandomness: result.usesRandomness || value.usesRandomness, observesHiddenInformation: result.observesHiddenInformation || value.observesHiddenInformation }), none());

function locationIsVisible(location: EffectCardLocation, state: GameState, context: EffectContext, viewerId: string): boolean {
  if (location.kind === 'context-location') { const resolved = context.locationRefs?.[location.key]; return Boolean(resolved && locationIsVisible(resolved, state, context, viewerId)); }
  if (location.kind === 'shared-zone') return state.zones[location.zoneId]?.visibility === 'public';
  if (location.kind === 'removed') return false;
  const ownerId = resolveEffectPlayerId(location.player, context);
  if (ownerId !== viewerId) return false;
  return location.kind !== 'player-zone' || location.zone !== 'drawPile';
}

function sourceIsVisible(source: EffectSelectableCardSource, state: GameState, context: EffectContext, viewerId: string): boolean {
  const resolved = resolveSelectableCardSource(source, context);
  return Boolean(resolved && sourceLocations(resolved).every((location) => location.kind === 'shared-zone' ? state.zones[location.zoneId]?.visibility === 'public' : location.player.playerId === viewerId));
}

/** Conservative metadata for deciding whether speculative effect execution is safe to expose in a PlayerView-derived query. */
export function inspectEffectPreviewUncertainty(node: EffectNode, state: GameState, context: EffectContext, viewerId: string): EffectPreviewUncertainty {
  if (node.kind === 'sequence') return merge(node.effects.map((effect) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'conditional') return merge([
    node.condition.kind === 'has-card-at' && !locationIsVisible(node.condition.location, state, context, viewerId) ? { usesRandomness: false, observesHiddenInformation: true } : none(),
    inspectEffectPreviewUncertainty(node.whenTrue, state, context, viewerId),
    ...(node.whenFalse ? [inspectEffectPreviewUncertainty(node.whenFalse, state, context, viewerId)] : []),
  ]);
  if (node.kind === 'choice') return merge(node.options.map(({ effect }) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'choose-order-player-deck-top' || node.kind === 'repeat-item-use-effect') return { usesRandomness: true, observesHiddenInformation: true };
  if (node.kind === 'repeat-discard-hand-for-combat') return { usesRandomness: false, observesHiddenInformation: resolveEffectPlayerId(node.player, context) !== viewerId };
  if (node.kind === 'choose-shared-row-refresh-subset' || node.kind === 'refresh-shared-row-selection') return { usesRandomness: false, observesHiddenInformation: true };
  if (node.kind === 'choose-card') return merge([
    { usesRandomness: false, observesHiddenInformation: !sourceIsVisible(node.from, state, context, viewerId) },
    inspectEffectPreviewUncertainty(node.effect, state, context, viewerId),
    ...(node.zeroCandidateEffect ? [inspectEffectPreviewUncertainty(node.zeroCandidateEffect, state, context, viewerId)] : []),
  ]);
  if (node.kind === 'random' || node.kind === 'roll-die') return merge([{ usesRandomness: true, observesHiddenInformation: false }, ...node.outcomes.map(({ effect }) => inspectEffectPreviewUncertainty(effect, state, context, viewerId))]);
  if (node.kind === 'request-counter-consent') return merge(Object.values(node.outcomes).map((effect) => inspectEffectPreviewUncertainty(effect, state, context, viewerId)));
  if (node.kind === 'draw') return { usesRandomness: false, observesHiddenInformation: typeof node.count !== 'number' || node.count > 0 };
  if (node.kind === 'draw-shared-deck') return { usesRandomness: false, observesHiddenInformation: node.count > 0 };
  if (node.kind === 'discard-hand-and-draw' || node.kind === 'discard-party-and-hand' || node.kind === 'reveal-shared-deck-to-zone' || node.kind === 'refresh-supply-row' || node.kind === 'enforce-team-capacity') return { usesRandomness: false, observesHiddenInformation: true };
  if (node.kind === 'reveal-player-deck-until' || node.kind === 'reveal-player-deck-top') return { usesRandomness: true, observesHiddenInformation: true };
  if (node.kind === 'grant-combat-reward') return { usesRandomness: false, observesHiddenInformation: node.rewards.some((reward) => reward.kind === 'draw' && reward.count > 0) };
  if (node.kind === 'create-enemy-encounter' || node.kind === 'create-enemy-target' || node.kind === 'attach-card-to-enemy-target' || node.kind === 'damage-enemy-target' || node.kind === 'defeat-enemy-target' || node.kind === 'remove-enemy-target' || node.kind === 'finish-enemy-encounter') return { usesRandomness: false, observesHiddenInformation: true };
  if (node.kind === 'move-card' || node.kind === 'discard-card' || node.kind === 'remove-from-game') return { usesRandomness: false, observesHiddenInformation: !locationIsVisible(node.from, state, context, viewerId) };
  return none();
}
