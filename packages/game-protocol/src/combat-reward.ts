import { z } from 'zod';
import { validateEffectDefinition, type EffectDefinition } from './effects.js';

export type CombatRewardCondition =
  | { kind: 'always'; value: boolean }
  | { kind: 'target-kind-in'; kinds: readonly string[] }
  | { kind: 'target-definition-id-in'; definitionIds: readonly string[] }
  | { kind: 'encounter-kind-in'; kinds: readonly string[] }
  | { kind: 'player-counter-at-least'; resourceId: string; amount: number }
  | { kind: 'all'; conditions: readonly CombatRewardCondition[] }
  | { kind: 'any'; conditions: readonly CombatRewardCondition[] }
  | { kind: 'not'; condition: CombatRewardCondition };

export type CombatRewardPolicy = { schemaVersion: 1; rewardPolicyId: string; moduleId: string; priority?: number; condition: CombatRewardCondition; recipient: 'defeating-player'; reward: EffectDefinition };
export type CombatRewardPolicyRef = { moduleId: string; rewardPolicyId: string };
export type CombatRewardEvaluationInput = { schemaVersion: 1; playerId: string; targetId: string; cardInstanceId: string; definitionId: string; targetKind: string; encounterId?: string; encounterKind?: string };
export type CombatRewardEvaluation = { schemaVersion: 1; input: CombatRewardEvaluationInput; matchedPolicies: readonly CombatRewardPolicyRef[]; registry: { rulesetVersion: string; modules: readonly { id: string; version: string }[] } };

const strings = z.array(z.string().trim().min(1)).min(1);
export const CombatRewardConditionSchema: z.ZodType<CombatRewardCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('target-kind-in'), kinds: strings }).strict(),
  z.object({ kind: z.literal('target-definition-id-in'), definitionIds: strings }).strict(),
  z.object({ kind: z.literal('encounter-kind-in'), kinds: strings }).strict(),
  z.object({ kind: z.literal('player-counter-at-least'), resourceId: z.string().trim().min(1), amount: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(CombatRewardConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(CombatRewardConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: CombatRewardConditionSchema }).strict()
]));
export const CombatRewardPolicySchema = z.object({ schemaVersion: z.literal(1), rewardPolicyId: z.string().trim().min(1), moduleId: z.string().trim().min(1), priority: z.number().finite().optional(), condition: CombatRewardConditionSchema, recipient: z.literal('defeating-player'), reward: z.object({ schemaVersion: z.literal(1), effectId: z.string().trim().min(1), body: z.unknown() }).passthrough() }).strict();
function jsonOnly(value: unknown, ancestors = new Set<object>()): boolean { if (value === null || typeof value === 'string' || typeof value === 'boolean') return true; if (typeof value === 'number') return Number.isFinite(value); if (typeof value !== 'object' || ancestors.has(value)) return false; const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false; ancestors.add(value); const valid = Array.isArray(value) ? value.every((entry) => jsonOnly(entry, ancestors)) : Object.values(value as Record<string, unknown>).every((entry) => jsonOnly(entry, ancestors)); ancestors.delete(value); return valid; }
export function validateCombatRewardPolicy(policy: CombatRewardPolicy, moduleId: string): string[] { const label = typeof policy === 'object' && policy !== null && 'rewardPolicyId' in policy ? String(policy.rewardPolicyId) : '<invalid>'; if (!jsonOnly(policy)) return [`Combat reward policy ${label} must contain finite, acyclic JSON-serializable data only.`]; const parsed = CombatRewardPolicySchema.safeParse(policy); const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Combat reward policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`); if (parsed.success && parsed.data.moduleId !== moduleId) errors.push(`Combat reward policy ${label} must belong to module ${moduleId}.`); if (parsed.success) errors.push(...validateEffectDefinition(policy.reward).map((error) => `Combat reward policy ${label}: ${error}`)); return errors; }
