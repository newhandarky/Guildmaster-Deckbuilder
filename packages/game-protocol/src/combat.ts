import { z } from 'zod';

/** JSON-only predicates interpreted by the authoritative combat evaluator. */
export type CombatCondition =
  | { kind: 'always'; value: boolean }
  | { kind: 'phase-is'; phase: import('./state.js').Phase }
  | { kind: 'target-kind-in'; kinds: readonly string[] }
  | { kind: 'player-counter-at-least'; resourceId: string; amount: number }
  | { kind: 'all'; conditions: readonly CombatCondition[] }
  | { kind: 'any'; conditions: readonly CombatCondition[] }
  | { kind: 'not'; condition: CombatCondition };

type CombatRuleBase = { schemaVersion: 1; ruleId: string; moduleId: string; priority?: number; when: CombatCondition };
export type CombatModifierRule = CombatRuleBase & { kind: 'modifier'; amount: number };
export type CombatRestrictionRule = CombatRuleBase & { kind: 'restriction'; reasonCode: string };
export type CombatReplacementOutcome = { kind: 'defeat-target' } | { kind: 'remove-target' };
export type CombatReplacementRule = CombatRuleBase & { kind: 'replacement'; outcome: CombatReplacementOutcome };
export type CombatRule = CombatModifierRule | CombatRestrictionRule | CombatReplacementRule;

export type CombatRuleRef = { moduleId: string; ruleId: string };
export type CombatEvaluation = {
  schemaVersion: 1;
  requiredCombat: number;
  eligible: boolean;
  restrictionReasonCodes: readonly string[];
  outcome: CombatReplacementOutcome;
  appliedRules: readonly CombatRuleRef[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

export const CombatConditionSchema: z.ZodType<CombatCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('phase-is'), phase: z.enum(['action1', 'combat', 'action2', 'purchase', 'rest']) }).strict(),
  z.object({ kind: z.literal('target-kind-in'), kinds: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('player-counter-at-least'), resourceId: z.string().trim().min(1), amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(CombatConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(CombatConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: CombatConditionSchema }).strict()
]));

const combatRuleBase = { schemaVersion: z.literal(1), ruleId: z.string().trim().min(1), moduleId: z.string().trim().min(1), priority: z.number().finite().optional(), when: CombatConditionSchema };
export const CombatRuleSchema = z.discriminatedUnion('kind', [
  z.object({ ...combatRuleBase, kind: z.literal('modifier'), amount: z.number().finite() }).strict(),
  z.object({ ...combatRuleBase, kind: z.literal('restriction'), reasonCode: z.string().trim().min(1) }).strict(),
  z.object({ ...combatRuleBase, kind: z.literal('replacement'), outcome: z.discriminatedUnion('kind', [z.object({ kind: z.literal('defeat-target') }).strict(), z.object({ kind: z.literal('remove-target') }).strict()]) }).strict()
]);

const combatRuleRefSchema = z.object({ moduleId: z.string(), ruleId: z.string() }).strict();
const combatRegistrySchema = z.object({ rulesetVersion: z.string(), modules: z.array(z.object({ id: z.string(), version: z.string() }).strict()) }).strict();
export const CombatEvaluationSchema: z.ZodType<CombatEvaluation> = z.object({
  schemaVersion: z.literal(1),
  requiredCombat: z.number().finite().nonnegative(),
  eligible: z.boolean(),
  restrictionReasonCodes: z.array(z.string()),
  outcome: z.discriminatedUnion('kind', [z.object({ kind: z.literal('defeat-target') }).strict(), z.object({ kind: z.literal('remove-target') }).strict()]),
  appliedRules: z.array(combatRuleRefSchema),
  registry: combatRegistrySchema
}).strict();

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value); const valid = value.every((entry) => isJsonValue(entry, ancestors)); ancestors.delete(value); return valid;
  }
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || ancestors.has(value)) return false;
  ancestors.add(value); const valid = Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, ancestors)); ancestors.delete(value); return valid;
}

export function validateCombatRule(rule: CombatRule, moduleId: string): string[] {
  const label = typeof (rule as { ruleId?: unknown }).ruleId === 'string' ? (rule as { ruleId: string }).ruleId : '<invalid>';
  if (!isJsonValue(rule)) return [`Combat rule ${label} must contain finite, acyclic JSON-serializable data only.`];
  const parsed = CombatRuleSchema.safeParse(rule);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat rule ${label} has invalid runtime data at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Combat rule ${label} must belong to module ${moduleId}.`);
  return errors;
}
