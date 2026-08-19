import { z } from 'zod';

export type CombatDepartureReplacement =
  | { readonly kind: 'self-to-player-draw-top' }
  | { readonly kind: 'discard-attached-card'; readonly attachmentDefinitionTypes: readonly string[] };

/** Source-card policy for an optional replacement of a normal combat discard. */
export type CombatDepartureReplacementPolicy = {
  readonly schemaVersion: 1;
  readonly moduleId: string;
  readonly policyId: string;
  readonly priority: number;
  readonly sourceDefinitionIds: readonly string[];
  readonly replacement: CombatDepartureReplacement;
  readonly reasonCode: string;
};

export type CombatDepartureReplacementCandidate = {
  readonly candidateId: string;
  readonly adventurerId: string;
  readonly replacement: CombatDepartureReplacement;
  readonly attachmentCardId?: string;
  readonly policy: { readonly moduleId: string; readonly policyId: string };
  readonly reasonCode: string;
};

const id = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
export const CombatDepartureReplacementPolicySchema: z.ZodType<CombatDepartureReplacementPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int().safe(),
  sourceDefinitionIds: z.array(id).min(1).refine((values) => new Set(values).size === values.length),
  replacement: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('self-to-player-draw-top') }).strict(),
    z.object({ kind: z.literal('discard-attached-card'), attachmentDefinitionTypes: z.array(id).min(1).refine((values) => new Set(values).size === values.length) }).strict(),
  ]),
  reasonCode: id,
}).strict();

export function validateCombatDepartureReplacementPolicy(policy: CombatDepartureReplacementPolicy, moduleId: string): string[] {
  const parsed = CombatDepartureReplacementPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat departure replacement policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Combat departure replacement policy ${parsed.data.policyId} must belong to module ${moduleId}.`);
  return errors;
}
