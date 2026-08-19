import { z } from 'zod';

export type AttachmentCombatContribution = 'printed-combat' | 'printed-purchase-power' | 'fixed';

/** JSON-only authorization for attaching a hand card to a party adventurer. */
export type AttachmentPolicy = {
  readonly schemaVersion: 1;
  readonly moduleId: string;
  readonly policyId: string;
  readonly priority: number;
  readonly sourceDefinitionIds?: readonly string[] | undefined;
  readonly sourceDefinitionTypes?: readonly string[] | undefined;
  readonly wearerDefinitionIds?: readonly string[] | undefined;
  readonly capacity: number;
  readonly combatContribution: AttachmentCombatContribution;
  readonly fixedCombat?: number | undefined;
  readonly reasonCode: string;
};

export type AttachmentEvaluationInput = {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly cardId: string;
  readonly adventurerId: string;
};

export type AttachmentEvaluation = {
  readonly schemaVersion: 1;
  readonly eligible: boolean;
  readonly capacity: number;
  readonly attachedCardIds: readonly string[];
  readonly requiresReplacement: boolean;
  readonly combatContribution: AttachmentCombatContribution;
  readonly fixedCombat?: number;
  readonly appliedPolicy?: { readonly moduleId: string; readonly policyId: string };
  readonly reasonCode: string;
  readonly registry: { readonly rulesetVersion: string; readonly modules: readonly { readonly id: string; readonly version: string }[] };
};

const id = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
export const AttachmentPolicySchema: z.ZodType<AttachmentPolicy> = z.object({
  schemaVersion: z.literal(1), moduleId: id, policyId: id, priority: z.number().finite().int().safe(),
  sourceDefinitionIds: z.array(id).min(1).optional(), sourceDefinitionTypes: z.array(id).min(1).optional(), wearerDefinitionIds: z.array(id).min(1).optional(),
  capacity: z.number().int().positive().max(16), combatContribution: z.enum(['printed-combat', 'printed-purchase-power', 'fixed']), fixedCombat: z.number().int().safe().optional(), reasonCode: id,
}).strict().superRefine((value, context) => {
  if (!value.sourceDefinitionIds?.length && !value.sourceDefinitionTypes?.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Attachment policy requires a source selector.' });
  if (value.combatContribution === 'fixed' && value.fixedCombat === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedCombat'], message: 'Fixed contribution requires fixedCombat.' });
  if (value.combatContribution !== 'fixed' && value.fixedCombat !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedCombat'], message: 'fixedCombat is only valid for fixed contribution.' });
});
export const AttachmentEvaluationInputSchema: z.ZodType<AttachmentEvaluationInput> = z.object({ schemaVersion: z.literal(1), playerId: id, cardId: id, adventurerId: id }).strict();

export function validateAttachmentPolicy(policy: AttachmentPolicy, moduleId: string): string[] {
  const label = typeof (policy as { policyId?: unknown }).policyId === 'string' ? policy.policyId : '<invalid>';
  const parsed = AttachmentPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Attachment policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (parsed.data.moduleId !== moduleId) errors.push(`Attachment policy ${label} must belong to module ${moduleId}.`);
  for (const ids of [parsed.data.sourceDefinitionIds, parsed.data.sourceDefinitionTypes, parsed.data.wearerDefinitionIds]) if (ids && new Set(ids).size !== ids.length) errors.push(`Attachment policy ${label} selectors must be unique.`);
  return errors;
}
