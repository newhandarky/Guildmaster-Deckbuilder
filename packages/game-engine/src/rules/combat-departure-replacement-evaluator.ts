import type { CombatDepartureReplacementCandidate, CombatParticipantDepartureEvaluation, GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type CombatDepartureReplacementEvaluationResult =
  | { readonly status: 'ready'; readonly candidates: readonly CombatDepartureReplacementCandidate[]; readonly registry: { readonly rulesetVersion: string; readonly modules: readonly { readonly id: string; readonly version: string }[] } }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'unsupported'; readonly error: string };

/** Canonical optional subsets that respect every shared per-turn usage quota. */
export function legalCombatDepartureReplacementSelections(state: GameState, playerId: string, candidates: readonly CombatDepartureReplacementCandidate[]): string[][] {
  const ids = candidates.map(({ candidateId }) => candidateId);
  const uses = state.turnFacts?.playerId === playerId ? state.turnFacts.effectUses ?? {} : {};
  return Array.from({ length: 2 ** ids.length }, (_, mask) => ids.filter((_id, index) => (mask & (1 << index)) !== 0)).filter((selectedIds) => {
    const selected = new Set(selectedIds);
    const quotas = new Map<string, { count: number; maxUses: number }>();
    for (const candidate of candidates) {
      if (!selected.has(candidate.candidateId) || !candidate.usage) continue;
      const current = quotas.get(candidate.usage.usageId) ?? { count: 0, maxUses: candidate.usage.maxUses };
      current.count += 1;
      current.maxUses = Math.min(current.maxUses, candidate.usage.maxUses);
      quotas.set(candidate.usage.usageId, current);
    }
    return [...quotas.entries()].every(([usageId, quota]) => (uses[usageId] ?? 0) + quota.count <= quota.maxUses);
  });
}

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
    if (selected.usage) {
      if (selected.usage.scope !== 'controller-turn' || state.turnFacts?.playerId !== playerId) continue;
      if ((state.turnFacts.effectUses?.[selected.usage.usageId] ?? 0) >= selected.usage.maxUses) continue;
    }
    if (selected.replacement.kind === 'discard-attached-card') {
      const attachmentCardId = attachedCardIds(slot).find((cardId) => selected.replacement.kind === 'discard-attached-card' && selected.replacement.attachmentDefinitionTypes.includes(getDefinition(ruleset.registry, state, cardId).type));
      if (!attachmentCardId) continue;
      candidates.push({ candidateId: slot.adventurerId, adventurerId: slot.adventurerId, replacement: structuredClone(selected.replacement), ...(selected.usage ? { usage: structuredClone(selected.usage) } : {}), attachmentCardId, policy: { moduleId: selected.moduleId, policyId: selected.policyId }, reasonCode: selected.reasonCode });
    } else candidates.push({ candidateId: slot.adventurerId, adventurerId: slot.adventurerId, replacement: structuredClone(selected.replacement), ...(selected.usage ? { usage: structuredClone(selected.usage) } : {}), policy: { moduleId: selected.moduleId, policyId: selected.policyId }, reasonCode: selected.reasonCode });
  }
  return { status: 'ready', candidates, registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) } };
}
