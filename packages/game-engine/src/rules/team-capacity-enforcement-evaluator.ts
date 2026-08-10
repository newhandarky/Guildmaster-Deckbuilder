import type { GameState, TeamCapacityEnforcementEvaluation } from '@guildmaster/game-protocol';
import { getPartyLimit, type Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type TeamCapacityEnforcementResult =
  | { status: 'ready'; evaluation: TeamCapacityEnforcementEvaluation }
  | { status: 'unsupported'; reason: 'MISSING_POLICY' | 'AMBIGUOUS_POLICY'; error: string }
  | { status: 'failed'; reason: 'REGISTRY_VERSION_MISMATCH' | 'INVALID_CAPACITY'; error: string };

/** Pure authoritative evaluation for capacity reductions caused by a rules change. */
export function evaluateTeamCapacityEnforcement(
  state: GameState,
  ruleset: Ruleset,
  policyId: string,
): TeamCapacityEnforcementResult {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const policies = ruleset.modules.flatMap((module) => module.teamCapacityEnforcementPolicies ?? [])
    .filter((policy) => policy.policyId === policyId);
  if (!policies.length) return { status: 'unsupported', reason: 'MISSING_POLICY', error: `Unknown team capacity enforcement policy: ${policyId}.` };
  if (policies.length !== 1) return { status: 'unsupported', reason: 'AMBIGUOUS_POLICY', error: `Ambiguous team capacity enforcement policy: ${policyId}.` };
  const policy = policies[0]!;
  const players = state.players.map((player) => {
    const capacity = getPartyLimit(ruleset, state, player);
    if (!Number.isSafeInteger(capacity) || capacity < 0) return undefined;
    const overflowCount = Math.max(0, player.party.length - capacity);
    const candidateIds = overflowCount
      ? player.party.slice(-overflowCount).reverse().map(({ adventurerId }) => adventurerId)
      : [];
    return { playerId: player.id, capacity, overflowCount, candidateIds };
  });
  if (players.some((player) => !player)) return { status: 'failed', reason: 'INVALID_CAPACITY', error: 'Team capacity enforcement resolved an invalid capacity.' };
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      policy: { moduleId: policy.moduleId, policyId: policy.policyId, mode: policy.mode, reasonCode: policy.reasonCode },
      players: players as TeamCapacityEnforcementEvaluation['players'],
      registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
    },
  };
}
