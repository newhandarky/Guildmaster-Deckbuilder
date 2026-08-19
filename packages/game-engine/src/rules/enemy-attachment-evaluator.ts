import type { EnemyAttachmentPolicy, EnemyTargetState, GameState, PlayerState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { getZone } from '../model/zones.js';
import type { Ruleset } from './ruleset.js';

function matchingPolicies(state: GameState, ruleset: Ruleset, target: EnemyTargetState): EnemyAttachmentPolicy[] {
  const definitionId = state.cards[target.cardInstanceId]?.definitionId;
  return ruleset.modules.flatMap((module) => module.enemyAttachmentPolicies ?? []).filter((policy) => definitionId !== undefined && policy.targetDefinitionIds.includes(definitionId)).sort((left, right) => left.priority - right.priority);
}

export function applyEnemyEntryAttachment(state: GameState, ruleset: Ruleset, target: EnemyTargetState): void {
  if (target.attachments.length) return;
  const policies = matchingPolicies(state, ruleset, target);
  if (policies.some((policy, index) => index > 0 && policy.priority === policies[index - 1]!.priority)) throw new Error('Matching enemy attachment policies require distinct priorities.');
  const selected = policies.at(-1); if (!selected) return;
  const cardId = getZone(state, selected.sourceZoneId).cardIds.pop(); if (!cardId) return;
  delete state.cards[cardId]!.ownerId; target.attachments.push(cardId);
}

export function enemyAttachmentCombat(state: GameState, ruleset: Ruleset, target: EnemyTargetState): number {
  const policies = matchingPolicies(state, ruleset, target); const selected = policies.at(-1);
  if (!selected) return 0;
  return target.attachments.reduce((sum, cardId) => sum + (getDefinition(ruleset.registry, state, cardId).combat ?? 0), 0);
}

export function disposeEnemyAttachments(state: GameState, ruleset: Ruleset, target: EnemyTargetState, winner: PlayerState): void {
  if (!target.attachments.length) return;
  const policies = matchingPolicies(state, ruleset, target); const selected = policies.at(-1);
  for (const cardId of target.attachments.splice(0)) {
    if (selected?.onDefeat === 'winner-discard') { state.cards[cardId]!.ownerId = winner.id; winner.discardPile.push(cardId); }
    else { delete state.cards[cardId]!.ownerId; state.removedCards.push(cardId); }
  }
}
