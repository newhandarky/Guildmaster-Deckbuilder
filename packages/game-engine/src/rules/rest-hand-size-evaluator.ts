import { RestHandSizeEvaluationInputSchema, type GameState, type RestHandSizeEvaluation, type RestHandSizeEvaluationInput, type RestHandSizePolicy } from '@guildmaster/game-protocol';
import { matchesCardPresence, validateCardPresenceState } from './card-presence.js';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

export const baseRestHandSize = 5;
export type RestHandSizeEvaluationResult =
  | { status: 'ready'; evaluation: RestHandSizeEvaluation }
  | { status: 'failed'; reason: 'INVALID_INPUT' | 'REGISTRY_VERSION_MISMATCH' | 'UNKNOWN_PLAYER' | 'PLAYER_NOT_ACTIVE' | 'INVALID_ACTIVATION'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

function ordered(policies: readonly RestHandSizePolicy[]): readonly RestHandSizePolicy[] | undefined {
  const result = [...policies].sort((left, right) => left.priority - right.priority);
  return result.some((policy, index) => index > 0 && policy.priority === result[index - 1]!.priority) ? undefined : result;
}

/** Pure evaluation of the active player's hand size at the rest boundary. */
export function evaluateRestHandSize(state: GameState, ruleset: Ruleset, input: RestHandSizeEvaluationInput): RestHandSizeEvaluationResult {
  if (!RestHandSizeEvaluationInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Rest hand-size evaluation input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  if (!state.players.some(({ id }) => id === input.playerId)) return { status: 'failed', reason: 'UNKNOWN_PLAYER', error: `Unknown rest player ${input.playerId}.` };
  if (state.activePlayerId !== input.playerId) return { status: 'failed', reason: 'PLAYER_NOT_ACTIVE', error: `Rest hand-size policy only applies to the active player.` };
  const policies = ruleset.modules.flatMap((module) => module.restHandSizePolicies ?? []);
  for (const policy of policies) {
    const activationError = validateCardPresenceState(state, ruleset.registry, policy.activation);
    if (activationError) return { status: 'failed', reason: 'INVALID_ACTIVATION', error: activationError };
  }
  const sorted = ordered(policies.filter((policy) => matchesCardPresence(state, policy.activation)));
  if (!sorted) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Active rest hand-size policies require distinct priorities.' };
  const applied = sorted[0];
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      input: structuredClone(input),
      baseHandSize: baseRestHandSize,
      effectiveHandSize: applied?.handSize ?? baseRestHandSize,
      ...(applied ? { appliedPolicy: { moduleId: applied.moduleId, policyId: applied.policyId } } : {}),
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
    },
  };
}
