import { z } from 'zod';

export type CombatParticipantDisposition =
  | { readonly kind: 'discard' }
  | { readonly kind: 'remove-from-game' }
  | { readonly kind: 'shuffle-into-shared-deck'; readonly zoneId: string };

/** JSON-only policy for replacing the normal post-combat participant discard. */
export type CombatParticipantDeparturePolicy = {
  readonly schemaVersion: 1;
  readonly moduleId: string;
  readonly policyId: string;
  readonly priority: number;
  readonly targetDefinitionIds: readonly string[];
  readonly dispositions: readonly {
    readonly definitionTypes: readonly string[];
    readonly destination: CombatParticipantDisposition;
  }[];
  readonly replacementDraw?: {
    readonly sourceZoneId: string;
    readonly destination: 'discardPile';
    readonly count: 'participant-count';
  } | undefined;
  readonly reasonCode: string;
};

export type CombatParticipantDepartureInput = {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly targetId: string;
  readonly participantCardIds: readonly string[];
};

export type CombatParticipantDepartureEvaluation = {
  readonly schemaVersion: 1;
  readonly participantDispositions: readonly {
    readonly cardId: string;
    readonly destination: CombatParticipantDisposition;
  }[];
  readonly replacementDraw?: {
    readonly sourceZoneId: string;
    readonly destination: 'discardPile';
    readonly count: number;
  };
  readonly appliedPolicy?: { readonly moduleId: string; readonly policyId: string };
  readonly reasonCode: string;
  readonly registry: { readonly rulesetVersion: string; readonly modules: readonly { readonly id: string; readonly version: string }[] };
};

const id = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
const disposition: z.ZodType<CombatParticipantDisposition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('discard') }).strict(),
  z.object({ kind: z.literal('remove-from-game') }).strict(),
  z.object({ kind: z.literal('shuffle-into-shared-deck'), zoneId: id }).strict(),
]);

export const CombatParticipantDeparturePolicySchema: z.ZodType<CombatParticipantDeparturePolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int().safe(),
  targetDefinitionIds: z.array(id).min(1),
  dispositions: z.array(z.object({ definitionTypes: z.array(id).min(1), destination: disposition }).strict()).min(1),
  replacementDraw: z.object({ sourceZoneId: id, destination: z.literal('discardPile'), count: z.literal('participant-count') }).strict().optional(),
  reasonCode: id,
}).strict();

export const CombatParticipantDepartureInputSchema: z.ZodType<CombatParticipantDepartureInput> = z.object({
  schemaVersion: z.literal(1), playerId: id, targetId: id, participantCardIds: z.array(id),
}).strict();

function jsonOnly(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) { if (ancestors.has(value)) return false; ancestors.add(value); const valid = value.every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid; }
  if (typeof value !== 'object' || ancestors.has(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  ancestors.add(value); const valid = Object.values(value as Record<string, unknown>).every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid;
}

export function validateCombatParticipantDeparturePolicy(policy: CombatParticipantDeparturePolicy, moduleId: string): string[] {
  const label = typeof (policy as { policyId?: unknown }).policyId === 'string' ? (policy as { policyId: string }).policyId : '<invalid>';
  if (!jsonOnly(policy)) return [`Combat participant departure policy ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = CombatParticipantDeparturePolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat participant departure policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (parsed.data.moduleId !== moduleId) errors.push(`Combat participant departure policy ${label} must belong to module ${moduleId}.`);
  if (new Set(parsed.data.targetDefinitionIds).size !== parsed.data.targetDefinitionIds.length) errors.push(`Combat participant departure policy ${label} target definition IDs must be unique.`);
  const types = parsed.data.dispositions.flatMap(({ definitionTypes }) => definitionTypes);
  if (new Set(types).size !== types.length) errors.push(`Combat participant departure policy ${label} definition types must not overlap.`);
  return errors;
}
