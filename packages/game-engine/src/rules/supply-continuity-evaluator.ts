import { isFiniteJsonValue, type GameState } from '@guildmaster/game-protocol';
import { getDefinition } from '../model/factories.js';
import { attachedCardIds } from '../model/attachments.js';
import type { Ruleset, SupplyKind } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type SupplyContinuityPolicy =
  | {
      schemaVersion: 1;
      policyId: string;
      moduleId: string;
      priority: number;
      supply: 'adventurer' | 'item';
      supplyRowConfigurationId: string;
      mode: 'allow-partial';
      depletionEvent: 'emit-on-empty';
    }
  | {
      schemaVersion: 1;
      policyId: string;
      moduleId: string;
      priority: number;
      supply: 'monster';
      supplyRowConfigurationId: string;
      mode: 'require-full-cycle';
      targetSize: number;
      cycleAnchorTag: string;
      cycleDestination: 'source-deck-bottom';
      depletionEvent: 'never';
    };

export type SupplyContinuityFailureReason =
  | 'MISSING_SUPPLY_CONTINUITY_POLICY'
  | 'AMBIGUOUS_SUPPLY_CONTINUITY_POLICY'
  | 'INVALID_SUPPLY_CONTINUITY_POLICY'
  | 'SUPPLY_CONTINUITY_VIOLATION'
  | 'CYCLE_ANCHOR_REMOVAL_FORBIDDEN';

export type SupplyContinuityResult =
  | { status: 'ready'; policy: SupplyContinuityPolicy }
  | { status: 'failed'; reason: SupplyContinuityFailureReason; error: string };

const failure = (reason: SupplyContinuityFailureReason, error: string): SupplyContinuityResult => ({ status: 'failed', reason, error });

export function validateSupplyContinuityPolicy(policy: SupplyContinuityPolicy, moduleId: string): string[] {
  const errors: string[] = [];
  if (!isFiniteJsonValue(policy)) errors.push(`Supply continuity policy ${policy.policyId ?? '<invalid>'} must contain finite, acyclic, plain JSON data only.`);
  if (policy.schemaVersion !== 1) errors.push(`Supply continuity policy ${policy.policyId} has an unsupported schema version.`);
  if (!policy.policyId.trim() || !policy.moduleId.trim() || policy.moduleId !== moduleId) errors.push('Supply continuity policy requires non-empty IDs and matching module ownership.');
  if (!Number.isFinite(policy.priority)) errors.push(`Supply continuity policy ${policy.policyId} requires a finite priority.`);
  if (!policy.supplyRowConfigurationId.trim()) errors.push(`Supply continuity policy ${policy.policyId} requires a supply row configuration.`);
  if (policy.mode === 'allow-partial') {
    if (policy.supply !== 'adventurer' && policy.supply !== 'item') errors.push(`Allow-partial policy ${policy.policyId} only supports adventurer or item supply.`);
    if ((policy.depletionEvent as string) !== 'emit-on-empty') errors.push(`Allow-partial policy ${policy.policyId} requires emit-on-empty depletion auditing.`);
  } else {
    if (policy.supply !== 'monster' || !Number.isInteger(policy.targetSize) || policy.targetSize <= 0 || !policy.cycleAnchorTag.trim()) errors.push(`Full-cycle policy ${policy.policyId} has invalid monster continuity settings.`);
    if ((policy.cycleDestination as string) !== 'source-deck-bottom' || (policy.depletionEvent as string) !== 'never') errors.push(`Full-cycle policy ${policy.policyId} requires source-deck-bottom recycling without depletion events.`);
  }
  return errors;
}

export function supplyContinuityPolicyFor(ruleset: Ruleset, supply: SupplyKind): SupplyContinuityResult {
  const policies = ruleset.modules.flatMap((module) => module.supplyContinuityPolicies ?? []).filter((policy) => policy.supply === supply);
  if (!policies.length) return failure('MISSING_SUPPLY_CONTINUITY_POLICY', `No supply continuity policy is registered for ${supply}.`);
  const ordered = [...policies].sort((left, right) => left.priority - right.priority);
  if (ordered.length > 1 && ordered[0]!.priority === ordered[1]!.priority) return failure('AMBIGUOUS_SUPPLY_CONTINUITY_POLICY', `Supply continuity policy order is ambiguous for ${supply}.`);
  return { status: 'ready', policy: ordered[0]! };
}

export function supplyContinuityPolicyForConfiguration(ruleset: Ruleset, supplyRowConfigurationId: string): SupplyContinuityResult | undefined {
  const policies = ruleset.modules
    .flatMap((module) => module.supplyContinuityPolicies ?? [])
    .filter((policy) => policy.supplyRowConfigurationId === supplyRowConfigurationId)
    .sort((left, right) => left.priority - right.priority);
  if (!policies.length) return undefined;
  if (policies.length > 1 && policies[0]!.priority === policies[1]!.priority) {
    return failure('AMBIGUOUS_SUPPLY_CONTINUITY_POLICY', `Supply continuity policy order is ambiguous for ${supplyRowConfigurationId}.`);
  }
  return { status: 'ready', policy: policies[0]! };
}

export function validateSupplyContinuityRegistry(ruleset: Ruleset): string[] {
  const errors: string[] = [];
  for (const supply of ['adventurer', 'item', 'monster'] as const) {
    const result = supplyContinuityPolicyFor(ruleset, supply);
    if (result.status !== 'ready') {
      errors.push(result.error);
      continue;
    }
    const policy = result.policy;
    const configuration = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.configurationId === policy.supplyRowConfigurationId);
    if (!configuration || configuration.supply !== supply) errors.push(`Supply continuity policy ${policy.policyId} refers to an incompatible supply row configuration.`);
    if (policy.mode !== 'require-full-cycle') continue;
    if (configuration && configuration.targetSize !== policy.targetSize) errors.push(`Supply continuity policy ${policy.policyId} target size does not match its row configuration.`);
    const anchors = Object.values(ruleset.registry.definitions).filter((definition) => definition.tags?.includes(policy.cycleAnchorTag));
    if (anchors.length !== 1 || anchors[0]?.type !== 'monster' || anchors[0].copies !== policy.targetSize) errors.push(`Supply continuity policy ${policy.policyId} requires exactly one ${policy.targetSize}-copy monster definition tagged ${policy.cycleAnchorTag}.`);
  }
  return errors;
}

export function validateSupplyContinuityState(state: GameState, ruleset: Ruleset): string[] {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return [compatibility];
  const result = supplyContinuityPolicyFor(ruleset, 'monster');
  if (result.status !== 'ready') return [result.error];
  const policy = result.policy;
  if (policy.mode !== 'require-full-cycle') return ['Base monster supply requires a full-cycle continuity policy.'];
  const configuration = ruleset.modules.flatMap((module) => module.supplyRowConfigurations ?? []).find((entry) => entry.configurationId === policy.supplyRowConfigurationId);
  if (!configuration) return [`Unknown monster supply configuration: ${policy.supplyRowConfigurationId}.`];
  const row = state.zones[configuration.targetRowZoneId];
  const deck = state.zones[configuration.sourceDeckZoneId];
  if (!row || !deck) return ['Monster supply continuity zones are missing.'];
  const errors: string[] = [];
  if (row.cardIds.length !== policy.targetSize) errors.push(`SUPPLY_CONTINUITY_VIOLATION: monster row must contain exactly ${policy.targetSize} cards.`);
  for (const cardId of row.cardIds) {
    const targets = Object.values(state.enemyTargets).filter((target) => target.cardInstanceId === cardId && target.status === 'available');
    if (targets.length !== 1) errors.push(`SUPPLY_CONTINUITY_VIOLATION: monster row card ${cardId} must have exactly one available target.`);
  }
  const anchorIds = Object.values(state.cards).filter((card) => getDefinition(ruleset.registry, state, card.id).tags?.includes(policy.cycleAnchorTag)).map(({ id }) => id);
  if (anchorIds.length !== policy.targetSize) errors.push(`SUPPLY_CONTINUITY_VIOLATION: active state must contain exactly ${policy.targetSize} cycle anchors.`);
  for (const player of state.players) {
    const playerCards = [...player.drawPile, ...player.hand, ...player.discardPile, ...player.playArea, ...player.party.flatMap((slot) => [slot.adventurerId, ...attachedCardIds(slot)])];
    for (const cardId of anchorIds) if (playerCards.includes(cardId)) errors.push(`SUPPLY_CONTINUITY_VIOLATION: cycle anchor ${cardId} cannot enter a player-owned zone.`);
  }
  for (const cardId of anchorIds) if (!row.cardIds.includes(cardId) && !deck.cardIds.includes(cardId)) errors.push(`SUPPLY_CONTINUITY_VIOLATION: cycle anchor ${cardId} must remain in the monster supply cycle.`);
  return errors;
}

export function evaluateMonsterDefeatContinuity(state: GameState, ruleset: Ruleset, targetId: string, outcome?: 'defeat-target' | 'remove-target'): SupplyContinuityResult & { recycle?: boolean } {
  const errors = validateSupplyContinuityState(state, ruleset);
  if (errors.length) return { status: 'failed', reason: 'SUPPLY_CONTINUITY_VIOLATION', error: errors.join(' ') };
  const result = supplyContinuityPolicyFor(ruleset, 'monster');
  if (result.status !== 'ready') return result;
  const target = state.enemyTargets[targetId];
  if (!target || target.kind !== 'monster' || target.status !== 'available') return failure('SUPPLY_CONTINUITY_VIOLATION', `Target ${targetId} is not an available monster.`);
  const policy = result.policy;
  const recycle = policy.mode === 'require-full-cycle' && getDefinition(ruleset.registry, state, target.cardInstanceId).tags?.includes(policy.cycleAnchorTag) === true;
  if (recycle && outcome === 'remove-target') return failure('CYCLE_ANCHOR_REMOVAL_FORBIDDEN', `Cycle anchor target ${targetId} cannot resolve to remove-target.`);
  return { status: 'ready', policy, recycle };
}
