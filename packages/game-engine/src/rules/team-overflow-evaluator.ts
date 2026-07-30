import { TeamOverflowInputSchema, type GameState, type TeamOverflowEvaluation, type TeamOverflowInput } from '@guildmaster/game-protocol';
import { getPartyLimit, type Ruleset } from './ruleset.js';
import { evaluateContinuousEffects } from './continuous-evaluator.js';
export type TeamOverflowResult = { status: 'ready'; evaluation: TeamOverflowEvaluation } | { status: 'unsupported'; reason: 'MISSING_POLICY' | 'ORDER_POLICY_REQUIRED'; error: string } | { status: 'failed'; reason: 'UNKNOWN_MODULE' | 'REGISTRY_VERSION_MISMATCH' | 'INVALID_INPUT'; error: string };
export function evaluateTeamOverflow(state: GameState, ruleset: Ruleset, input: TeamOverflowInput): TeamOverflowResult {
  if (!TeamOverflowInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Invalid team overflow input.' };
  const player = state.players.find(({ id }) => id === input.playerId); if (!player || !state.cards[input.incomingMemberId]) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Unknown player or incoming team member.' };
  const a = state.rulesModules.map(({ id, version }) => `${id}@${version}`).join('|'), b = ruleset.modules.map(({ id, version }) => `${id}@${version}`).join('|');
  if (a !== b) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: 'Team overflow registry version mismatch.' };
  const continuous = evaluateContinuousEffects(state, ruleset); if (continuous.status === 'unsupported') return { status: 'unsupported', reason: continuous.reason, error: continuous.error }; if (continuous.status === 'failed') return { status: 'failed', reason: continuous.reason, error: continuous.error };
  const capacity = getPartyLimit(ruleset, state, player); const overflowCount = Math.max(0, player.party.length + 1 - capacity); const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) };
  if (!overflowCount) return { status: 'ready', evaluation: { schemaVersion: 1, status: 'allowed', capacity, overflowCount, candidateIds: [], registry } };
  const policies = ruleset.modules.flatMap((module) => module.teamOverflowPolicies ?? []); if (!policies.length) return { status: 'unsupported', reason: 'MISSING_POLICY', error: 'Team capacity overflow requires an explicit Rules Module policy.' };
  if (policies.some(({ priority }) => priority === undefined)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Team overflow policies require explicit priorities.' };
  const ordered = [...policies].sort((x, y) => x.priority! - y.priority!); if (ordered.some((p, i) => i && p.priority === ordered[i - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Team overflow policies have ambiguous priority.' };
  const policy = ordered[0]!; const candidateIds = policy.mode === 'discard-oldest' ? player.party.slice(0, overflowCount).map((slot) => slot.adventurerId) : policy.mode === 'discard-newest' ? player.party.slice().reverse().slice(0, overflowCount).map((slot) => slot.adventurerId) : player.party.map((slot) => slot.adventurerId);
  return { status: 'ready', evaluation: { schemaVersion: 1, status: 'overflow-required', capacity, overflowCount, candidateIds, policy: { moduleId: policy.moduleId, policyId: policy.policyId, mode: policy.mode, reasonCode: policy.reasonCode }, registry } };
}
