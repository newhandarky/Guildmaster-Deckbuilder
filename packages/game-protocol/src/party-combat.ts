import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');

export type PartyCombatCondition =
  | { kind: 'always'; value: boolean }
  | { kind: 'phase-is'; phase: import('./state.js').Phase }
  | { kind: 'target-kind-in'; kinds: readonly ('monster' | 'boss' | 'raidPart')[] }
  | { kind: 'source-position-in'; positions: readonly number[] }
  | { kind: 'subject-position-in'; positions: readonly number[] }
  | { kind: 'party-size-at-least'; amount: number }
  | { kind: 'party-tag-count-at-least'; tags: readonly string[]; amount: number }
  | { kind: 'subject-tag-in'; tags: readonly string[] }
  | { kind: 'all'; conditions: readonly PartyCombatCondition[] }
  | { kind: 'any'; conditions: readonly PartyCombatCondition[] }
  | { kind: 'not'; condition: PartyCombatCondition };

export type PartyCombatModifierRule = {
  schemaVersion: 1;
  ruleId: string;
  moduleId: string;
  priority: number;
  sourceDefinitionIds: readonly string[];
  subject: 'source' | 'other' | 'first' | 'adjacent' | 'all';
  when: PartyCombatCondition;
  amount:
    | { kind: 'fixed'; value: number }
    | { kind: 'per-other-party-member'; value: number }
    | {
        kind: 'public-enemy-combat-tier';
        targetKinds: readonly ('monster' | 'boss' | 'raidPart')[];
        tiers: readonly { minimum: number; maximum?: number | undefined; amount: number }[];
      };
};

export type PartyCombatEvaluationInput = { schemaVersion: 1; playerId: string; targetId?: string; equipmentSuppressed?: boolean };
export type PartyCombatEvaluation = {
  schemaVersion: 1;
  members: readonly {
    adventurerId: string;
    equipmentId?: string;
    equipmentIds?: readonly string[];
    printedCombat: number;
    equipmentCombat: number;
    modifierCombat: number;
    effectiveCombat: number;
    appliedRules: readonly { moduleId: string; ruleId: string; sourceCardId: string; amount: number }[];
  }[];
  registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
};

export const PartyCombatConditionSchema: z.ZodType<PartyCombatCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('phase-is'), phase: z.enum(['action1', 'combat', 'action2', 'purchase', 'rest']) }).strict(),
  z.object({ kind: z.literal('target-kind-in'), kinds: z.array(z.enum(['monster', 'boss', 'raidPart'])).min(1) }).strict(),
  z.object({ kind: z.literal('source-position-in'), positions: z.array(z.number().int().positive()).min(1) }).strict(),
  z.object({ kind: z.literal('subject-position-in'), positions: z.array(z.number().int().positive()).min(1) }).strict(),
  z.object({ kind: z.literal('party-size-at-least'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('party-tag-count-at-least'), tags: z.array(canonicalId).min(1), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('subject-tag-in'), tags: z.array(canonicalId).min(1) }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(PartyCombatConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(PartyCombatConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: PartyCombatConditionSchema }).strict(),
]));

export const PartyCombatModifierRuleSchema: z.ZodType<PartyCombatModifierRule> = z.object({
  schemaVersion: z.literal(1), ruleId: canonicalId, moduleId: canonicalId, priority: z.number().finite(),
  sourceDefinitionIds: z.array(canonicalId).min(1),
  subject: z.enum(['source', 'other', 'first', 'adjacent', 'all']),
  when: PartyCombatConditionSchema,
  amount: z.union([
    z.object({ kind: z.literal('fixed'), value: z.number().finite().int() }).strict(),
    z.object({ kind: z.literal('per-other-party-member'), value: z.number().finite().int() }).strict(),
    z.object({
      kind: z.literal('public-enemy-combat-tier'),
      targetKinds: z.array(z.enum(['monster', 'boss', 'raidPart'])).min(1)
        .refine((values) => new Set(values).size === values.length, 'Target kinds must be unique.'),
      tiers: z.array(z.object({
        minimum: z.number().finite().int().nonnegative(),
        maximum: z.number().finite().int().nonnegative().optional(),
        amount: z.number().finite().int(),
      }).strict()).min(1).refine((tiers) => tiers.every((tier, index) => {
        if (tier.maximum !== undefined && tier.maximum < tier.minimum) return false;
        const previous = tiers[index - 1];
        return !previous || (previous.maximum !== undefined && tier.minimum > previous.maximum);
      }), 'Combat tiers must be ordered and non-overlapping.'),
    }).strict(),
  ]),
}).strict();

export const PartyCombatEvaluationInputSchema = z.object({
  schemaVersion: z.literal(1), playerId: canonicalId, targetId: canonicalId.optional(), equipmentSuppressed: z.boolean().optional(),
}).strict();

export function validatePartyCombatModifierRule(rule: PartyCombatModifierRule, moduleId: string): string[] {
  const label = typeof (rule as { ruleId?: unknown }).ruleId === 'string' ? rule.ruleId : '<invalid>';
  if (!isFiniteJsonValue(rule)) return [`Party combat modifier rule ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = PartyCombatModifierRuleSchema.safeParse(rule);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Party combat modifier rule ${label} is invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Party combat modifier rule ${label} must belong to module ${moduleId}.`);
  if (parsed.success && new Set(parsed.data.sourceDefinitionIds).size !== parsed.data.sourceDefinitionIds.length) errors.push(`Party combat modifier rule ${label} source definition IDs must be unique.`);
  return errors;
}
