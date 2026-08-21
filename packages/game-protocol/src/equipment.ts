import { z } from 'zod';

/** JSON-only predicates interpreted by the authoritative equipment evaluator. */
export type EquipmentEligibilityCondition =
  | { kind: 'always'; value: boolean }
  | { kind: 'phase-is'; phase: import('./state.js').Phase }
  | { kind: 'target-kind-in'; kinds: readonly ('monster' | 'boss' | 'raidPart')[] }
  | { kind: 'equipment-definition-in'; definitionIds: readonly string[] }
  | { kind: 'adventurer-definition-in'; definitionIds: readonly string[] }
  | { kind: 'adventurer-tag-in'; tags: readonly string[] }
  | { kind: 'player-counter-at-least'; resourceId: string; amount: number }
  | { kind: 'all'; conditions: readonly EquipmentEligibilityCondition[] }
  | { kind: 'any'; conditions: readonly EquipmentEligibilityCondition[] }
  | { kind: 'not'; condition: EquipmentEligibilityCondition };

export type EquipmentEligibilityRule = {
  schemaVersion: 1;
  ruleId: string;
  moduleId: string;
  priority?: number;
  when: EquipmentEligibilityCondition;
  kind: 'restriction';
  reasonCode: string;
};

/** Adds power only for an attached equipment/adventurer pair matching `when`. */
export type EquipmentCombatModifierRule = {
  schemaVersion: 1;
  ruleId: string;
  moduleId: string;
  priority?: number;
  when: EquipmentEligibilityCondition;
  kind: 'combat-power-modifier';
  amount: number;
};

export type EquipmentEligibilityRuleRef = { moduleId: string; ruleId: string };
export type EquipmentEligibilityInput = { schemaVersion: 1; playerId: string; equipmentCardId: string; adventurerId: string; targetId?: string };
export type EquipmentEligibilityEvaluation = {
  schemaVersion: 1;
  eligible: boolean;
  rejectionReasonCodes: readonly string[];
  appliedRules: readonly EquipmentEligibilityRuleRef[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};
export type EquipmentCombatModifierEvaluation = {
  schemaVersion: 1;
  powerBonus: number;
  appliedRules: readonly EquipmentEligibilityRuleRef[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

export const EquipmentEligibilityConditionSchema: z.ZodType<EquipmentEligibilityCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('phase-is'), phase: z.enum(['action1', 'combat', 'action2', 'purchase', 'rest']) }).strict(),
  z.object({ kind: z.literal('target-kind-in'), kinds: z.array(z.enum(['monster', 'boss', 'raidPart'])).min(1) }).strict(),
  z.object({ kind: z.literal('equipment-definition-in'), definitionIds: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('adventurer-definition-in'), definitionIds: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('adventurer-tag-in'), tags: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('player-counter-at-least'), resourceId: z.string().trim().min(1), amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(EquipmentEligibilityConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(EquipmentEligibilityConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: EquipmentEligibilityConditionSchema }).strict()
]));

export const EquipmentEligibilityRuleSchema = z.object({
  schemaVersion: z.literal(1), ruleId: z.string().trim().min(1), moduleId: z.string().trim().min(1), priority: z.number().finite().optional(),
  when: EquipmentEligibilityConditionSchema, kind: z.literal('restriction'), reasonCode: z.string().trim().min(1)
}).strict();
export const EquipmentCombatModifierRuleSchema = z.object({
  schemaVersion: z.literal(1), ruleId: z.string().trim().min(1), moduleId: z.string().trim().min(1), priority: z.number().finite().optional(),
  when: EquipmentEligibilityConditionSchema, kind: z.literal('combat-power-modifier'), amount: z.number().finite()
}).strict();
export const EquipmentEligibilityInputSchema = z.object({ schemaVersion: z.literal(1), playerId: z.string().trim().min(1), equipmentCardId: z.string().trim().min(1), adventurerId: z.string().trim().min(1), targetId: z.string().trim().min(1).optional() }).strict();
const ruleRef = z.object({ moduleId: z.string(), ruleId: z.string() }).strict();
const registry = z.object({ rulesetVersion: z.string(), modules: z.array(z.object({ id: z.string(), version: z.string() }).strict()) }).strict();
export const EquipmentEligibilityEvaluationSchema: z.ZodType<EquipmentEligibilityEvaluation> = z.object({ schemaVersion: z.literal(1), eligible: z.boolean(), rejectionReasonCodes: z.array(z.string()), appliedRules: z.array(ruleRef), registry }).strict();

function jsonOnly(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) { if (ancestors.has(value)) return false; ancestors.add(value); const valid = value.every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid; }
  if (typeof value !== 'object') return false;
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || ancestors.has(value)) return false;
  ancestors.add(value); const valid = Object.values(value as Record<string, unknown>).every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid;
}

export function validateEquipmentEligibilityRule(rule: EquipmentEligibilityRule, moduleId: string): string[] {
  const label = typeof (rule as { ruleId?: unknown }).ruleId === 'string' ? (rule as { ruleId: string }).ruleId : '<invalid>';
  if (!jsonOnly(rule)) return [`Equipment eligibility rule ${label} must contain finite, acyclic JSON-serializable data only.`];
  const parsed = EquipmentEligibilityRuleSchema.safeParse(rule);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Equipment eligibility rule ${label} has invalid runtime data at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Equipment eligibility rule ${label} must belong to module ${moduleId}.`);
  return errors;
}

export function validateEquipmentCombatModifierRule(rule: EquipmentCombatModifierRule, moduleId: string): string[] {
  const label = typeof (rule as { ruleId?: unknown }).ruleId === 'string' ? (rule as { ruleId: string }).ruleId : '<invalid>';
  if (!jsonOnly(rule)) return [`Equipment combat modifier rule ${label} must contain finite, acyclic JSON-serializable data only.`];
  const parsed = EquipmentCombatModifierRuleSchema.safeParse(rule);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Equipment combat modifier rule ${label} has invalid runtime data at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Equipment combat modifier rule ${label} must belong to module ${moduleId}.`);
  return errors;
}
