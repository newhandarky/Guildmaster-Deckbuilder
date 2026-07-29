import { z } from 'zod';
export type BondPlayerZone = 'drawPile' | 'hand' | 'discardPile' | 'playArea' | 'party' | 'equipment';
export type BondCondition = { kind: 'defeated-bosses-at-least'; amount: number } | { kind: 'defeated-monsters-at-least'; amount: number } | { kind: 'counter-at-least'; resourceId: string; amount: number } | { kind: 'completed-bonds-at-least'; amount: number } | { kind: 'card-definition-present'; definitionId: string; zones: readonly BondPlayerZone[] } | { kind: 'card-type-present'; cardType: 'starter' | 'adventurer' | 'equipment' | 'item' | 'monster' | 'boss'; zones: readonly BondPlayerZone[] } | { kind: 'party-member-present'; definitionId?: string | undefined } | { kind: 'equipment-present'; definitionId?: string | undefined } | { kind: 'all'; conditions: readonly BondCondition[] } | { kind: 'any'; conditions: readonly BondCondition[] } | { kind: 'not'; condition: BondCondition };
export type BondConditionRule = { schemaVersion: 1; ruleId: string; moduleId: string; bondId: string; priority?: number; condition: BondCondition };
export type BondEvaluation = { schemaVersion: 1; satisfied: boolean; appliedRules: readonly { moduleId: string; ruleId: string }[]; registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] } };
const zones = z.array(z.enum(['drawPile','hand','discardPile','playArea','party','equipment'])).min(1);
export const BondConditionSchema: z.ZodType<BondCondition> = z.lazy(() => z.union([z.object({ kind: z.literal('defeated-bosses-at-least'), amount: z.number().int().nonnegative() }).strict(), z.object({ kind: z.literal('defeated-monsters-at-least'), amount: z.number().int().nonnegative() }).strict(), z.object({ kind: z.literal('counter-at-least'), resourceId: z.string().min(1), amount: z.number().finite().nonnegative() }).strict(), z.object({ kind: z.literal('completed-bonds-at-least'), amount: z.number().int().nonnegative() }).strict(), z.object({ kind: z.literal('card-definition-present'), definitionId: z.string().min(1), zones }).strict(), z.object({ kind: z.literal('card-type-present'), cardType: z.enum(['starter','adventurer','equipment','item','monster','boss']), zones }).strict(), z.object({ kind: z.literal('party-member-present'), definitionId: z.string().min(1).optional() }).strict(), z.object({ kind: z.literal('equipment-present'), definitionId: z.string().min(1).optional() }).strict(), z.object({ kind: z.literal('all'), conditions: z.array(BondConditionSchema).min(1) }).strict(), z.object({ kind: z.literal('any'), conditions: z.array(BondConditionSchema).min(1) }).strict(), z.object({ kind: z.literal('not'), condition: BondConditionSchema }).strict()]));
export const BondConditionRuleSchema = z.object({ schemaVersion: z.literal(1), ruleId: z.string().min(1), moduleId: z.string().min(1), bondId: z.string().min(1), priority: z.number().finite().optional(), condition: BondConditionSchema }).strict();
function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value) ? value.every((entry) => isJsonValue(entry, ancestors)) : Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}
export function validateBondConditionRule(value: BondConditionRule, moduleId: string): string[] {
  const label = typeof value === 'object' && value !== null && 'ruleId' in value ? String(value.ruleId) : '<unknown>';
  if (!isJsonValue(value)) return [`Bond condition rule ${label} must contain finite, acyclic JSON-serializable data only.`];
  const parsed = BondConditionRuleSchema.safeParse(value);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Bond condition rule invalid at ${issue.path.join('.')}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Bond condition rule ${parsed.data.ruleId} must belong to module ${moduleId}.`);
  return errors;
}
