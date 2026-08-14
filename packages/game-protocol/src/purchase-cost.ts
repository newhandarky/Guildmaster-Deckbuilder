import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';
import { CardPresenceActivationSchema, type CardPresenceActivation } from './rule-activation.js';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');
const canonicalIds = z.array(canonicalId).min(1).refine((values) => new Set(values).size === values.length, 'Values must be unique.');

export type PurchaseCostModifierRule = {
  schemaVersion: 1;
  ruleId: string;
  moduleId: string;
  priority: number;
  activation: CardPresenceActivation;
  target: { kind: 'definition-type-in'; values: readonly string[] };
  amount: number;
};

export type PurchaseCostEvaluationInput = { schemaVersion: 1; playerId: string; cardId: string };
export type PurchaseCostRuleRef = { moduleId: string; ruleId: string; amount: number };
export type PurchaseCostEvaluation = {
  schemaVersion: 1;
  input: PurchaseCostEvaluationInput;
  printedCost: number;
  effectiveCost: number;
  appliedModifiers: readonly PurchaseCostRuleRef[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

export const PurchaseCostModifierRuleSchema: z.ZodType<PurchaseCostModifierRule> = z.object({
  schemaVersion: z.literal(1),
  ruleId: canonicalId,
  moduleId: canonicalId,
  priority: z.number().finite(),
  activation: CardPresenceActivationSchema,
  target: z.object({ kind: z.literal('definition-type-in'), values: canonicalIds }).strict(),
  amount: z.number().finite().int(),
}).strict();

export const PurchaseCostEvaluationInputSchema: z.ZodType<PurchaseCostEvaluationInput> = z.object({
  schemaVersion: z.literal(1), playerId: canonicalId, cardId: canonicalId,
}).strict();

const ruleRef = z.object({ moduleId: canonicalId, ruleId: canonicalId, amount: z.number().finite().int() }).strict();
const registry = z.object({ rulesetVersion: canonicalId, modules: z.array(z.object({ id: canonicalId, version: canonicalId }).strict()) }).strict();
export const PurchaseCostEvaluationSchema: z.ZodType<PurchaseCostEvaluation> = z.object({
  schemaVersion: z.literal(1),
  input: PurchaseCostEvaluationInputSchema,
  printedCost: z.number().finite().int().nonnegative(),
  effectiveCost: z.number().finite().int().nonnegative(),
  appliedModifiers: z.array(ruleRef),
  registry,
}).strict();

export function validatePurchaseCostModifierRule(rule: PurchaseCostModifierRule, moduleId: string): string[] {
  const label = typeof (rule as { ruleId?: unknown }).ruleId === 'string' ? rule.ruleId : '<invalid>';
  if (!isFiniteJsonValue(rule)) return [`Purchase cost modifier rule ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = PurchaseCostModifierRuleSchema.safeParse(rule);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Purchase cost modifier rule ${label} is invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Purchase cost modifier rule ${label} must belong to module ${moduleId}.`);
  return errors;
}
