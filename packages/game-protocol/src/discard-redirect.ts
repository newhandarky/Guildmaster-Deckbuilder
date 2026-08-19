import { z } from 'zod';

export type DiscardRedirectPolicy = {
  schemaVersion: 1;
  moduleId: string;
  policyId: string;
  priority: number;
  definitionIds: readonly string[];
  destination: 'right-seat-discard';
  reasonCode: string;
};

const id = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
export const DiscardRedirectPolicySchema: z.ZodType<DiscardRedirectPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int().safe(),
  definitionIds: z.array(id).min(1), destination: z.literal('right-seat-discard'), reasonCode: id,
}).strict();

export function validateDiscardRedirectPolicy(policy: DiscardRedirectPolicy, moduleId: string): string[] {
  const parsed = DiscardRedirectPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Discard redirect policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Discard redirect policy ${parsed.data.policyId} must belong to module ${moduleId}.`);
  if (parsed.success && new Set(parsed.data.definitionIds).size !== parsed.data.definitionIds.length) errors.push(`Discard redirect policy ${parsed.data.policyId} definition IDs must be unique.`);
  return errors;
}
