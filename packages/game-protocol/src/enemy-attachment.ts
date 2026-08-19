import { z } from 'zod';

/** Declarative entry attachment and terminal disposition for public enemy targets. */
export type EnemyAttachmentPolicy = {
  readonly schemaVersion: 1;
  readonly moduleId: string;
  readonly policyId: string;
  readonly priority: number;
  readonly targetDefinitionIds: readonly string[];
  readonly sourceZoneId: string;
  readonly combatContribution: 'printed-combat';
  readonly onDefeat: 'remove-from-game' | 'winner-discard';
  readonly reasonCode: string;
};

const id = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
export const EnemyAttachmentPolicySchema: z.ZodType<EnemyAttachmentPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int().safe(), targetDefinitionIds: z.array(id).min(1), sourceZoneId: id,
  combatContribution: z.literal('printed-combat'), onDefeat: z.enum(['remove-from-game', 'winner-discard']), reasonCode: id,
}).strict();

export function validateEnemyAttachmentPolicy(policy: EnemyAttachmentPolicy, moduleId: string): string[] {
  const label = typeof (policy as { policyId?: unknown }).policyId === 'string' ? policy.policyId : '<invalid>';
  const parsed = EnemyAttachmentPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Enemy attachment policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (parsed.data.moduleId !== moduleId) errors.push(`Enemy attachment policy ${label} must belong to module ${moduleId}.`);
  if (new Set(parsed.data.targetDefinitionIds).size !== parsed.data.targetDefinitionIds.length) errors.push(`Enemy attachment policy ${label} targets must be unique.`);
  return errors;
}
