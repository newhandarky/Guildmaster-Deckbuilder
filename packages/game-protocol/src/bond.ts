import { z } from 'zod';
export type BondPlayerZone = 'drawPile' | 'hand' | 'discardPile' | 'playArea' | 'party' | 'equipment';
export type BondNumericTurnFact = 'adventurersRecruited' | 'adventurersAddedToParty' | 'nonStarterAdventurersAddedToParty' | 'itemsBought' | 'equipmentBought' | 'purchasePowerSpent' | 'extraCardsDrawn' | 'itemsUsed' | 'bossesDefeated' | 'monstersDefeated' | 'actionPhaseItemsUsed' | 'lastCombatParticipantCount' | 'lastCombatDiscardedEquipment' | 'monstersUsedForPurchase';
export type BondCondition =
  | { kind: 'defeated-bosses-at-least'; amount: number }
  | { kind: 'defeated-monsters-at-least'; amount: number }
  | { kind: 'counter-at-least'; resourceId: string; amount: number }
  | { kind: 'completed-bonds-at-least'; amount: number }
  | { kind: 'card-definition-present'; definitionId: string; zones: readonly BondPlayerZone[] }
  | { kind: 'card-type-present'; cardType: 'starter' | 'adventurer' | 'equipment' | 'item' | 'monster' | 'boss'; zones: readonly BondPlayerZone[] }
  | { kind: 'party-member-present'; definitionId?: string | undefined }
  | { kind: 'equipment-present'; definitionId?: string | undefined }
  | { kind: 'phase-is'; phase: import('./state.js').Phase }
  | { kind: 'turn-fact-at-least'; fact: BondNumericTurnFact; amount: number }
  | { kind: 'turn-fact-distinct-values-at-least'; fact: 'lastCombatDiscardedNonStarterProfessions'; amount: number }
  | { kind: 'party-size-between'; minimum: number; maximum: number }
  | { kind: 'party-tag-count-at-least'; tags: readonly string[]; amount: number }
  | { kind: 'party-edge-tags'; edge: 'first' | 'last'; count: number; tags: readonly string[] }
  | { kind: 'party-distinct-tag-count-at-least'; tagPrefix: string; amount: number; nonStarterOnly?: boolean | undefined }
  | { kind: 'party-nonstarter-count-at-least'; amount: number }
  | { kind: 'party-all-tags-in'; tags: readonly string[]; minimum: number }
  | { kind: 'party-same-tag-count-at-least'; tagPrefix: string; amount: number; requireAll?: boolean | undefined }
  | { kind: 'all'; conditions: readonly BondCondition[] }
  | { kind: 'any'; conditions: readonly BondCondition[] }
  | { kind: 'not'; condition: BondCondition };
export type BondCompletionTiming = 'state' | 'combat-start' | 'combat-resolved';
export type BondConditionRule = { schemaVersion: 1; ruleId: string; moduleId: string; bondId: string; priority?: number; completionTiming?: BondCompletionTiming; condition: BondCondition };
export type BondEvaluation = { schemaVersion: 1; satisfied: boolean; appliedRules: readonly { moduleId: string; ruleId: string }[]; registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] } };
const zones = z.array(z.enum(['drawPile','hand','discardPile','playArea','party','equipment'])).min(1);
const bondTags = z.array(z.string().min(1)).min(1).refine((values) => new Set(values).size === values.length, 'Bond tags must be unique.');
const numericTurnFact = z.enum(['adventurersRecruited','adventurersAddedToParty','nonStarterAdventurersAddedToParty','itemsBought','equipmentBought','purchasePowerSpent','extraCardsDrawn','itemsUsed','bossesDefeated','monstersDefeated','actionPhaseItemsUsed','lastCombatParticipantCount','lastCombatDiscardedEquipment','monstersUsedForPurchase']);
export const BondConditionSchema: z.ZodType<BondCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('defeated-bosses-at-least'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('defeated-monsters-at-least'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('counter-at-least'), resourceId: z.string().min(1), amount: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal('completed-bonds-at-least'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('card-definition-present'), definitionId: z.string().min(1), zones }).strict(),
  z.object({ kind: z.literal('card-type-present'), cardType: z.enum(['starter','adventurer','equipment','item','monster','boss']), zones }).strict(),
  z.object({ kind: z.literal('party-member-present'), definitionId: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('equipment-present'), definitionId: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('phase-is'), phase: z.enum(['action1','combat','action2','purchase','rest']) }).strict(),
  z.object({ kind: z.literal('turn-fact-at-least'), fact: numericTurnFact, amount: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal('turn-fact-distinct-values-at-least'), fact: z.literal('lastCombatDiscardedNonStarterProfessions'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('party-size-between'), minimum: z.number().int().nonnegative(), maximum: z.number().int().nonnegative() }).strict().refine(({ minimum, maximum }) => minimum <= maximum, 'Party size minimum must not exceed maximum.'),
  z.object({ kind: z.literal('party-tag-count-at-least'), tags: bondTags, amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('party-edge-tags'), edge: z.enum(['first','last']), count: z.number().int().positive(), tags: bondTags }).strict(),
  z.object({ kind: z.literal('party-distinct-tag-count-at-least'), tagPrefix: z.string().min(1), amount: z.number().int().nonnegative(), nonStarterOnly: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('party-nonstarter-count-at-least'), amount: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('party-all-tags-in'), tags: bondTags, minimum: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('party-same-tag-count-at-least'), tagPrefix: z.string().min(1), amount: z.number().int().nonnegative(), requireAll: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(BondConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(BondConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: BondConditionSchema }).strict(),
]));
export const BondConditionRuleSchema = z.object({ schemaVersion: z.literal(1), ruleId: z.string().min(1), moduleId: z.string().min(1), bondId: z.string().min(1), priority: z.number().finite().optional(), completionTiming: z.enum(['state', 'combat-start', 'combat-resolved']).optional(), condition: BondConditionSchema }).strict();
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
