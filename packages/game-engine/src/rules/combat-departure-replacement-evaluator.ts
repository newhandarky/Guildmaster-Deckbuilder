import type { CombatDepartureReplacementCandidate, CombatParticipantDepartureEvaluation, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type CombatDepartureReplacementEvaluationResult =
  | { readonly status: 'ready'; readonly candidates: readonly CombatDepartureReplacementCandidate[]; readonly registry: { readonly rulesetVersion: string; readonly modules: readonly { readonly id: string; readonly version: string }[] } }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'unsupported'; readonly error: string };

/** Pure query for optional source-card replacements that only apply to a normal combat discard. */
export function evaluateCombatDepartureReplacements(state: GameState, ruleset: Ruleset, playerId: string, participantDeparture: CombatParticipantDepartureEvaluation): CombatDepartureReplacementEvaluationResult {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', error: compatibility };
  const player = state.players.find(({ id }) => id === playerId);
  if (!player) return { status: 'failed', error: 'Combat departure replacement player does not exist.' };
  const candidates: CombatDepartureReplacementCandidate[] = [];
  for (const disposition of participantDeparture.participantDispositions) {
    if (disposition.destination.kind !== 'discard') continue;
    const slot = player.party.find(({ adventurerId }) => adventurerId === disposition.cardId);
    if (!slot) return { status: 'failed', error: 'Combat departure replacement participant is no longer in the party.' };
    const definitionId = state.cards[slot.adventurerId]?.definitionId;
    const policies = ruleset.modules.flatMap((module) => module.combatDepartureReplacementPolicies ?? [])
      .filter((policy) => definitionId !== undefined && policy.sourceDefinitionIds.includes(definitionId))
      .sort((left, right) => left.priority - right.priority);
    if (policies.some((policy, index) => index > 0 && policy.priority === policies[index - 1]!.priority)) return { status: 'unsupported', error: `Combat departure replacement order is ambiguous for ${definitionId}.` };
    const selected = policies.at(-1);
    if (!selected) continue;
    if (selected.replacement.kind === 'discard-attached-card') {
      const attachmentCardId = attachedCardIds(slot).find((cardId) => selected.replacement.kind === 'discard-attached-card' && selected.replacement.attachmentDefinitionTypes.includes(getDefinition(ruleset.registry, state, cardId).type));
      if (!attachmentCardId) continue;
      candidates.push({ candidateId: slot.adventurerId, adventurerId: slot.adventurerId, replacement: structuredClone(selected.replacement), attachmentCardId, policy: { moduleId: selected.moduleId, policyId: selected.policyId }, reasonCode: selected.reasonCode });
    } else candidates.push({ candidateId: slot.adventurerId, adventurerId: slot.adventurerId, replacement: structuredClone(selected.replacement), policy: { moduleId: selected.moduleId, policyId: selected.policyId }, reasonCode: selected.reasonCode });
  }
  return { status: 'ready', candidates, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } };
}
