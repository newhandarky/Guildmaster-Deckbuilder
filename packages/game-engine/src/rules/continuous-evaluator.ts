import type { ContinuousEvaluation, GameState } from '@guildmaster/game-protocol';
import type { Ruleset } from './ruleset.js';
import { attachedCardIds } from '../model/attachments.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type ContinuousResult = { status: 'ready'; evaluation: ContinuousEvaluation } | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string } | { status: 'failed'; reason: 'REGISTRY_VERSION_MISMATCH'; error: string };
export type ContinuousPreviewUncertainty = { observesHiddenInformation: boolean };

function present(state: GameState, cardId: string): boolean {
  return Object.values(state.zones).some((zone) => zone.cardIds.includes(cardId))
    || state.players.some((player) => player.hand.includes(cardId) || player.playArea.includes(cardId) || player.party.some((slot) => slot.adventurerId === cardId || attachedCardIds(slot).includes(cardId)));
}

function sourceLocationIsVisible(state: GameState, viewerId: string, cardId: string): boolean {
  if (Object.values(state.zones).some((zone) => zone.visibility === 'public' && zone.cardIds.includes(cardId))) return true;
  const viewer = state.players.find(({ id }) => id === viewerId);
  if (viewer && (viewer.hand.includes(cardId) || viewer.discardPile.includes(cardId) || viewer.playArea.includes(cardId) || viewer.party.some((slot) => slot.adventurerId === cardId || attachedCardIds(slot).includes(cardId)))) return true;
  return Object.values(state.enemyTargets).some((target) => target.status !== 'defeated' && target.status !== 'removed' && (target.cardInstanceId === cardId || target.attachments.includes(cardId)));
}

/** Reports whether active continuous-rule selection can be derived from one PlayerView. */
export function inspectContinuousPreviewUncertainty(state: GameState, ruleset: Ruleset, viewerId: string): ContinuousPreviewUncertainty {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) throw new Error(compatibility);
  return {
    observesHiddenInformation: ruleset.modules
      .flatMap((module) => module.continuousRules ?? [])
      .some((rule) => rule.duration === 'while-source-present' && !sourceLocationIsVisible(state, viewerId, rule.sourceCardId)),
  };
}

export function evaluateContinuousEffects(state: GameState, ruleset: Ruleset): ContinuousResult {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const rules = ruleset.modules.flatMap((module) => module.continuousRules ?? []).filter((rule) => (rule.duration !== 'while-source-present' || present(state, rule.sourceCardId)) && (rule.duration !== 'this-combat' || state.phase === 'combat') && (rule.duration !== 'this-turn' || state.phase !== 'rest') && (rule.duration !== 'until-rest' || state.phase !== 'rest'));
  if (rules.length > 1 && (rules.some((rule) => rule.priority === undefined) || new Set(rules.map((rule) => rule.priority)).size !== rules.length)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Continuous effects require distinct explicit priorities.' };
  return { status: 'ready', evaluation: { schemaVersion: 1, active: [...rules].sort((a,b) => (a.priority ?? 0) - (b.priority ?? 0)).map((rule) => ({ moduleId: rule.moduleId, effectId: rule.effectId, target: rule.target, amount: rule.amount })), registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } } };
}
