import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';
import { CardPresenceActivationSchema, type CardPresenceActivation } from './rule-activation.js';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');

export type RestHandSizePolicy = {
  schemaVersion: 1;
  policyId: string;
  moduleId: string;
  priority: number;
  activation: CardPresenceActivation;
  playerScope: 'active-player';
  mode: 'replace';
  handSize: number;
};

export type RestHandSizeEvaluationInput = { schemaVersion: 1; playerId: string };
export type RestHandSizePolicyRef = { moduleId: string; policyId: string };
export type RestHandSizeEvaluation = {
  schemaVersion: 1;
  input: RestHandSizeEvaluationInput;
  baseHandSize: number;
  effectiveHandSize: number;
  appliedPolicy?: RestHandSizePolicyRef | undefined;
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

export const RestHandSizePolicySchema: z.ZodType<RestHandSizePolicy> = z.object({
  schemaVersion: z.literal(1),
  policyId: canonicalId,
  moduleId: canonicalId,
  priority: z.number().finite(),
  activation: CardPresenceActivationSchema,
  playerScope: z.literal('active-player'),
  mode: z.literal('replace'),
  handSize: z.number().finite().int().nonnegative(),
}).strict();

export const RestHandSizeEvaluationInputSchema: z.ZodType<RestHandSizeEvaluationInput> = z.object({
  schemaVersion: z.literal(1), playerId: canonicalId,
}).strict();

const registry = z.object({ rulesetVersion: canonicalId, modules: z.array(z.object({ id: canonicalId, version: canonicalId }).strict()) }).strict();
export const RestHandSizeEvaluationSchema: z.ZodType<RestHandSizeEvaluation> = z.object({
  schemaVersion: z.literal(1),
  input: RestHandSizeEvaluationInputSchema,
  baseHandSize: z.number().finite().int().nonnegative(),
  effectiveHandSize: z.number().finite().int().nonnegative(),
  appliedPolicy: z.object({ moduleId: canonicalId, policyId: canonicalId }).strict().optional(),
  registry,
}).strict();

export function validateRestHandSizePolicy(policy: RestHandSizePolicy, moduleId: string): string[] {
  const label = typeof (policy as { policyId?: unknown }).policyId === 'string' ? policy.policyId : '<invalid>';
  if (!isFiniteJsonValue(policy)) return [`Rest hand-size policy ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = RestHandSizePolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Rest hand-size policy ${label} is invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Rest hand-size policy ${label} must belong to module ${moduleId}.`);
  return errors;
}
