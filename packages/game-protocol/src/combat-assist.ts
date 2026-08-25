import { z } from 'zod';

/** Optional attack mode supplied by a party member that must not participate. */
export type CombatAssistPolicy = {
  schemaVersion: 1; moduleId: string; policyId: string; priority: number;
  sourceDefinitionIds: readonly string[];
  targetKinds: readonly ('monster' | 'boss')[];
  requiredCombat: { kind: 'divide'; divisor: number; rounding: 'ceil' };
  sourceDisposition: 'remove-from-game'; attachedCardsDisposition: 'discard';
  reasonCode: string;
};

const id = z.string().trim().min(1);
export const CombatAssistPolicySchema: z.ZodType<CombatAssistPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int(),
  sourceDefinitionIds: z.array(id).min(1).refine((values) => new Set(values).size === values.length),
  targetKinds: z.array(z.enum(['monster', 'boss'])).min(1).refine((values) => new Set(values).size === values.length),
  requiredCombat: z.object({ kind: z.literal('divide'), divisor: z.number().int().positive(), rounding: z.literal('ceil') }).strict(),
  sourceDisposition: z.literal('remove-from-game'), attachedCardsDisposition: z.literal('discard'), reasonCode: id,
}).strict();

export function validateCombatAssistPolicy(policy: CombatAssistPolicy, moduleId: string): string[] {
  const parsed = CombatAssistPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat assist policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Combat assist policy ${parsed.data.policyId} must belong to module ${moduleId}.`);
  return errors;
}
