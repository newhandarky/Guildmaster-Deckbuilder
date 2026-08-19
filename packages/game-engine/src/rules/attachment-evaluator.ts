import { AttachmentEvaluationInputSchema, type AttachmentEvaluation, type AttachmentEvaluationInput, type AttachmentPolicy, type GameState } from '@guildmaster/game-protocol';
import { attachedCardIds } from '../model/attachments.js';
import { getDefinition } from '../model/factories.js';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type AttachmentEvaluationResult =
  | { status: 'ready'; evaluation: AttachmentEvaluation }
  | { status: 'failed'; reason: 'INVALID_INPUT' | 'REGISTRY_VERSION_MISMATCH'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

function matches(policy: AttachmentPolicy, state: GameState, ruleset: Ruleset, input: AttachmentEvaluationInput): boolean {
  const source = getDefinition(ruleset.registry, state, input.cardId);
  const wearer = getDefinition(ruleset.registry, state, input.adventurerId);
  return (!policy.sourceDefinitionIds || policy.sourceDefinitionIds.includes(source.id))
    && (!policy.sourceDefinitionTypes || policy.sourceDefinitionTypes.includes(source.type))
    && (!policy.wearerDefinitionIds || policy.wearerDefinitionIds.includes(wearer.id));
}

/** Pure authoritative attachment/capacity query shared by legal commands and dispatch. */
export function evaluateAttachment(state: GameState, ruleset: Ruleset, input: AttachmentEvaluationInput): AttachmentEvaluationResult {
  if (!AttachmentEvaluationInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Attachment input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const player = state.players.find(({ id }) => id === input.playerId);
  const slot = player?.party.find(({ adventurerId }) => adventurerId === input.adventurerId);
  if (!player || !slot || !player.hand.includes(input.cardId) || !state.cards[input.cardId] || !state.cards[input.adventurerId] || input.cardId === input.adventurerId) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Attachment input must name a hand card and an existing party adventurer.' };
  const active = ruleset.modules.flatMap((module) => module.attachmentPolicies ?? []).filter((policy) => matches(policy, state, ruleset, input));
  const ordered = [...active].sort((left, right) => left.priority - right.priority);
  if (ordered.some((policy, index) => index > 0 && policy.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Matching attachment policies require distinct priorities.' };
  const selected = ordered.at(-1);
  const attached = attachedCardIds(slot);
  const legacyEquipment = getDefinition(ruleset.registry, state, input.cardId).type === 'equipment';
  const capacity = selected?.capacity ?? (legacyEquipment ? 1 : 0);
  const eligible = (Boolean(selected) || legacyEquipment) && !attached.includes(input.cardId);
  return { status: 'ready', evaluation: {
    schemaVersion: 1, eligible, capacity, attachedCardIds: attached,
    requiresReplacement: eligible && attached.length >= capacity,
    combatContribution: selected?.combatContribution ?? (legacyEquipment ? 'printed-combat' : 'fixed'), ...(selected?.fixedCombat !== undefined ? { fixedCombat: selected.fixedCombat } : {}),
    ...(selected ? { appliedPolicy: { moduleId: selected.moduleId, policyId: selected.policyId } } : {}),
    reasonCode: selected?.reasonCode ?? (legacyEquipment ? 'BASE_EQUIPMENT_ATTACHMENT' : 'NO_MATCHING_ATTACHMENT_POLICY'),
    registry: { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) },
  } };
}

export function attachmentCombat(state: GameState, ruleset: Ruleset, playerId: string, adventurerId: string, cardId: string): number {
  const source = getDefinition(ruleset.registry, state, cardId);
  const input = { schemaVersion: 1 as const, playerId, cardId, adventurerId };
  const policies = ruleset.modules.flatMap((module) => module.attachmentPolicies ?? []).filter((policy) => matches(policy, state, ruleset, input)).sort((left, right) => left.priority - right.priority);
  const selected = policies.at(-1);
  if (!selected) return source.type === 'equipment' ? source.combat ?? 0 : 0;
  if (selected.combatContribution === 'printed-combat') return source.combat ?? 0;
  if (selected.combatContribution === 'printed-purchase-power') return source.purchasePower ?? 0;
  return selected.fixedCombat ?? 0;
}
