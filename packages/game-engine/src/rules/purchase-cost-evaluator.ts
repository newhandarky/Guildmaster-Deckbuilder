import { PurchaseCostEvaluationInputSchema, type GameState, type PurchaseCostEvaluation, type PurchaseCostEvaluationInput, type PurchaseCostModifierRule } from '@guildmaster/game-protocol';
import { matchesCardPresence, validateCardPresenceState } from './card-presence.js';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

export type PurchaseCostEvaluationResult =
  | { status: 'ready'; evaluation: PurchaseCostEvaluation }
  | { status: 'failed'; reason: 'INVALID_INPUT' | 'REGISTRY_VERSION_MISMATCH' | 'UNKNOWN_PLAYER' | 'UNKNOWN_CARD' | 'CARD_HAS_NO_COST' | 'INVALID_ACTIVATION' | 'INVALID_COST_VALUE'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

function ordered(rules: readonly PurchaseCostModifierRule[]): readonly PurchaseCostModifierRule[] | undefined {
  const result = [...rules].sort((left, right) => left.priority - right.priority);
  return result.some((rule, index) => index > 0 && rule.priority === result[index - 1]!.priority) ? undefined : result;
}

/** Pure authoritative purchase cost evaluation shared by query, preview, and dispatch. */
export function evaluatePurchaseCost(state: GameState, ruleset: Ruleset, input: PurchaseCostEvaluationInput): PurchaseCostEvaluationResult {
  if (!PurchaseCostEvaluationInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Purchase cost evaluation input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  if (!state.players.some(({ id }) => id === input.playerId)) return { status: 'failed', reason: 'UNKNOWN_PLAYER', error: `Unknown purchase player ${input.playerId}.` };
  const card = state.cards[input.cardId];
  if (!card) return { status: 'failed', reason: 'UNKNOWN_CARD', error: `Unknown purchase card ${input.cardId}.` };
  const definition = ruleset.registry.definitions[card.definitionId];
  if (!definition) return { status: 'failed', reason: 'UNKNOWN_CARD', error: `Purchase card ${input.cardId} references unknown definition ${card.definitionId}.` };
  if (definition.cost === undefined) return { status: 'failed', reason: 'CARD_HAS_NO_COST', error: `Card ${input.cardId} has no printed purchase cost.` };
  const rules = ruleset.modules.flatMap((module) => module.purchaseCostModifierRules ?? []);
  for (const rule of rules) {
    const activationError = validateCardPresenceState(state, ruleset.registry, rule.activation);
    if (activationError) return { status: 'failed', reason: 'INVALID_ACTIVATION', error: activationError };
  }
  const active = rules.filter((rule) => matchesCardPresence(state, rule.activation, input.playerId) && rule.target.values.includes(definition.type));
  const sorted = ordered(active);
  if (!sorted) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Active purchase cost modifiers require distinct priorities.' };
  const modifier = sorted.reduce((sum, rule) => sum + rule.amount, 0);
  const effectiveCost = Math.max(0, definition.cost + modifier);
  if (!Number.isSafeInteger(effectiveCost)) return { status: 'failed', reason: 'INVALID_COST_VALUE', error: 'Purchase cost modifiers produced an unsafe cost value.' };
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      input: structuredClone(input),
      printedCost: definition.cost,
      effectiveCost,
      appliedModifiers: sorted.map(({ moduleId, ruleId, amount }) => ({ moduleId, ruleId, amount })),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
    },
  };
}
