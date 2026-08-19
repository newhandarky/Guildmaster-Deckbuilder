import { z } from 'zod';

/** Adds a non-participating party member's evaluated combat to the first participant. */
export type CombatReserveContributionPolicy = {
  schemaVersion: 1; moduleId: string; policyId: string; priority: number;
  sourceDefinitionIds: readonly string[];
  contribution: 'effective-combat'; destination: 'first-participant'; onlyWhileSourceNotParticipant: true;
  reasonCode: string;
};
const id = z.string().min(1).refine((value) => value === value.trim());
export const CombatReserveContributionPolicySchema: z.ZodType<CombatReserveContributionPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int(), sourceDefinitionIds: z.array(id).min(1).refine((values) => new Set(values).size === values.length), contribution: z.literal('effective-combat'), destination: z.literal('first-participant'), onlyWhileSourceNotParticipant: z.literal(true), reasonCode: id,
}).strict();
export function validateCombatReserveContributionPolicy(policy: CombatReserveContributionPolicy, moduleId: string): string[] {
  const parsed = CombatReserveContributionPolicySchema.safeParse(policy); const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat reserve contribution policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Combat reserve contribution policy ${parsed.data.policyId} must belong to module ${moduleId}.`);
  return errors;
}
