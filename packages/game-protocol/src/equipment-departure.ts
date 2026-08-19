import { z } from 'zod';

export type EquipmentDepartureCause = 'combat-discard' | 'team-overflow-discard' | 'effect-discard' | 'rest-discard';

/** JSON-only replacement policy for equipment leaving with its wearer. */
export type EquipmentDeparturePolicy = {
  schemaVersion: 1;
  moduleId: string;
  policyId: string;
  priority: number;
  equipmentDefinitionIds: readonly string[];
  cause: EquipmentDepartureCause;
  disposition: 'discard' | 'remove-from-game';
  rewards?: readonly { kind: 'draw'; count: number }[] | undefined;
  reasonCode: string;
};

export type EquipmentDepartureInput = {
  schemaVersion: 1;
  playerId: string;
  adventurerId: string;
  equipmentCardId: string;
  cause: EquipmentDepartureCause;
};

export type EquipmentDepartureEvaluation = {
  schemaVersion: 1;
  disposition: 'discard' | 'remove-from-game';
  appliedPolicy?: { moduleId: string; policyId: string };
  reasonCode: string;
  rewards: readonly { kind: 'draw'; count: number }[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
const cause = z.enum(['combat-discard', 'team-overflow-discard', 'effect-discard', 'rest-discard']);
export const EquipmentDeparturePolicySchema: z.ZodType<EquipmentDeparturePolicy> = z.object({
  schemaVersion: z.literal(1),
  moduleId: canonicalId,
  policyId: canonicalId,
  priority: z.number().finite().int().safe(),
  equipmentDefinitionIds: z.array(canonicalId).min(1),
  cause,
  disposition: z.enum(['discard', 'remove-from-game']),
  rewards: z.array(z.object({ kind: z.literal('draw'), count: z.number().finite().int().positive() }).strict()).max(8).optional(),
  reasonCode: canonicalId,
}).strict();
export const EquipmentDepartureInputSchema: z.ZodType<EquipmentDepartureInput> = z.object({
  schemaVersion: z.literal(1), playerId: canonicalId, adventurerId: canonicalId, equipmentCardId: canonicalId, cause,
}).strict();

function jsonOnly(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) { if (ancestors.has(value)) return false; ancestors.add(value); const valid = value.every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid; }
  if (typeof value !== 'object' || ancestors.has(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  ancestors.add(value); const valid = Object.values(value as Record<string, unknown>).every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid;
}

export function validateEquipmentDeparturePolicy(policy: EquipmentDeparturePolicy, moduleId: string): string[] {
  const label = typeof (policy as { policyId?: unknown }).policyId === 'string' ? (policy as { policyId: string }).policyId : '<invalid>';
  if (!jsonOnly(policy)) return [`Equipment departure policy ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = EquipmentDeparturePolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Equipment departure policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Equipment departure policy ${label} must belong to module ${moduleId}.`);
  if (parsed.success && new Set(parsed.data.equipmentDefinitionIds).size !== parsed.data.equipmentDefinitionIds.length) errors.push(`Equipment departure policy ${label} definition IDs must be unique.`);
  return errors;
}
