import { CombatParticipantDepartureInputSchema, type CombatParticipantDepartureEvaluation, type CombatParticipantDepartureInput, type CombatParticipantDeparturePolicy, type GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type CombatParticipantDepartureEvaluationResult =
  | { readonly status: 'ready'; readonly evaluation: CombatParticipantDepartureEvaluation }
  | { readonly status: 'failed'; readonly reason: 'REGISTRY_VERSION_MISMATCH' | 'INVALID_INPUT'; readonly error: string }
  | { readonly status: 'unsupported'; readonly reason: 'ORDER_POLICY_REQUIRED'; readonly error: string };

/** Pure evaluator. Mutation and deterministic shuffling are performed atomically by dispatch. */
export function evaluateCombatParticipantDeparture(state: GameState, ruleset: Ruleset, input: CombatParticipantDepartureInput): CombatParticipantDepartureEvaluationResult {
  if (!CombatParticipantDepartureInputSchema.safeParse(input).success || new Set(input.participantCardIds).size !== input.participantCardIds.length) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Combat participant departure input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const player = state.players.find(({ id }) => id === input.playerId);
  const target = state.enemyTargets[input.targetId];
  if (!player || !target || input.participantCardIds.some((cardId) => !player.party.some(({ adventurerId }) => adventurerId === cardId))) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Participants must belong to the attacking party and the target must exist.' };
  const targetDefinitionId = state.cards[target.cardInstanceId]?.definitionId;
  const matches = ruleset.modules.flatMap((module) => module.combatParticipantDeparturePolicies ?? []).filter((policy) => targetDefinitionId !== undefined && policy.targetDefinitionIds.includes(targetDefinitionId));
  const ordered = [...matches].sort((left, right) => left.priority - right.priority);
  if (ordered.some((policy, index) => index > 0 && policy.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Matching combat participant departure policies require distinct priorities.' };
  const selected: CombatParticipantDeparturePolicy | undefined = ordered.at(-1);
  const participantDispositions = input.participantCardIds.map((cardId) => {
    const definition = getDefinition(ruleset.registry, state, cardId);
    const destination = selected?.dispositions.find(({ definitionTypes }) => definitionTypes.includes(definition.type))?.destination ?? { kind: 'discard' as const };
    return { cardId, destination };
  });
  return { status: 'ready', evaluation: {
    schemaVersion: 1,
    participantDispositions,
    ...(selected?.replacementDraw ? { replacementDraw: { sourceZoneId: selected.replacementDraw.sourceZoneId, destination: selected.replacementDraw.destination, count: input.participantCardIds.length } } : {}),
    ...(selected ? { appliedPolicy: { moduleId: selected.moduleId, policyId: selected.policyId } } : {}),
    reasonCode: selected?.reasonCode ?? 'BASE_PARTICIPANTS_DISCARD_AFTER_COMBAT',
    registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
  } };
}
