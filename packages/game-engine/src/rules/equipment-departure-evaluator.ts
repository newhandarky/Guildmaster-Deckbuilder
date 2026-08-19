import { EquipmentDepartureInputSchema, type EquipmentDepartureEvaluation, type EquipmentDepartureInput, type EquipmentDeparturePolicy, type GameState } from '@guildmaster/game-protocol';
import type { Ruleset } from './ruleset.js';
import { attachedCardIds } from '../model/attachments.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type EquipmentDepartureEvaluationResult =
  | { status: 'ready'; evaluation: EquipmentDepartureEvaluation }
  | { status: 'failed'; reason: 'REGISTRY_VERSION_MISMATCH' | 'INVALID_INPUT'; error: string }
  | { status: 'unsupported'; reason: 'ORDER_POLICY_REQUIRED'; error: string };

const registry = (state: GameState, ruleset: Ruleset) => ({ rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) });

/** Pure deterministic replacement evaluation; callers apply the returned disposition atomically. */
export function evaluateEquipmentDeparture(state: GameState, ruleset: Ruleset, input: EquipmentDepartureInput): EquipmentDepartureEvaluationResult {
  if (!EquipmentDepartureInputSchema.safeParse(input).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment departure input is malformed.' };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility };
  const player = state.players.find(({ id }) => id === input.playerId);
  const slot = player?.party.find(({ adventurerId }) => adventurerId === input.adventurerId);
  const equipment = state.cards[input.equipmentCardId];
  if (!player || !slot || !attachedCardIds(slot).includes(input.equipmentCardId) || !equipment) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Equipment departure input must name an attached equipment/wearer pair.' };
  const active = ruleset.modules.flatMap((module) => module.equipmentDeparturePolicies ?? []).filter((policy) => policy.cause === input.cause && policy.equipmentDefinitionIds.includes(equipment.definitionId));
  const ordered = [...active].sort((left, right) => left.priority - right.priority);
  if (ordered.some((policy, index) => index > 0 && policy.priority === ordered[index - 1]!.priority)) return { status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED', error: 'Matching equipment departure policies require distinct priorities.' };
  const selected: EquipmentDeparturePolicy | undefined = ordered.at(-1);
  return {
    status: 'ready',
    evaluation: {
      schemaVersion: 1,
      disposition: selected?.disposition ?? 'discard',
      ...(selected ? { appliedPolicy: { moduleId: selected.moduleId, policyId: selected.policyId } } : {}),
      reasonCode: selected?.reasonCode ?? 'BASE_EQUIPMENT_FOLLOWS_WEARER_TO_DISCARD',
      rewards: structuredClone(selected?.rewards ?? []),
      registry: registry(state, ruleset),
    },
  };
}
