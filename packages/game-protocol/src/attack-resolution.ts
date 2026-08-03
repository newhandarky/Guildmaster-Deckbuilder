import { z } from 'zod';
import { CombatEvaluationSchema, type CombatEvaluation } from './combat.js';
import { EncounterPolicyRefSchema, EncounterReasonCodeSchema, EnemyTargetDamageEvaluationSchema, isFiniteJsonValue, type EncounterPolicyRef, type EncounterReasonCode, type EnemyTargetDamageEvaluation } from './encounter.js';

export type AttackResolutionCondition =
  | { kind: 'always'; value: boolean }
  | { kind: 'target-kind-in'; kinds: readonly string[] }
  | { kind: 'encounter-kind-in'; kinds: readonly string[] }
  | { kind: 'target-part-key-in'; partKeys: readonly string[] }
  | { kind: 'target-health-at-most'; amount: number }
  | { kind: 'player-counter-at-least'; resourceId: string; amount: number }
  | { kind: 'all'; conditions: readonly AttackResolutionCondition[] }
  | { kind: 'any'; conditions: readonly AttackResolutionCondition[] }
  | { kind: 'not'; condition: AttackResolutionCondition };

export type AttackResolutionPolicy = {
  schemaVersion: 1;
  moduleId: string;
  policyId: string;
  priority: number;
  ordering: 'explicit-priority';
  when: AttackResolutionCondition;
  damage: { kind: 'fixed'; amount: number };
  encounterPolicy: EncounterPolicyRef;
  reasonCode: EncounterReasonCode;
};

export type AttackResolutionPolicyRef = { moduleId: string; policyId: string };
export type AttackResolutionRegistryFingerprint = { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
export type AttackResolutionRequest = { schemaVersion: 1; playerId: string; targetId: string; registry: AttackResolutionRegistryFingerprint };
export type AttackResolutionEvaluation = {
  schemaVersion: 1;
  input: AttackResolutionRequest;
  policy: AttackResolutionPolicyRef;
  combat: CombatEvaluation;
  partyPrefix: { slotCount: number; power: number; participantCardIds: readonly string[] };
  damage: EnemyTargetDamageEvaluation;
  reasonCode: EncounterReasonCode;
};
export type AttackResolutionEventPayload = { schemaVersion: 1; kind: 'attack-resolution'; evaluation: AttackResolutionEvaluation };

export type AttackResolutionFailureCode =
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_MODULE'
  | 'REGISTRY_VERSION_MISMATCH'
  | 'UNKNOWN_PLAYER'
  | 'UNKNOWN_TARGET'
  | 'TARGET_NOT_AVAILABLE'
  | 'TARGET_HAS_NO_HEALTH'
  | 'ENCOUNTER_ALREADY_FINISHED'
  | 'NO_MATCHING_POLICY'
  | 'ORDER_POLICY_REQUIRED'
  | 'COMBAT_NOT_READY'
  | 'COMBAT_RESTRICTED'
  | 'INSUFFICIENT_COMBAT'
  | 'INVALID_ENCOUNTER_DAMAGE';
export type AttackResolutionFailure = { status: 'failed' | 'unsupported'; reason: AttackResolutionFailureCode; error: string };
export type AttackResolutionResult = { status: 'ready'; evaluation: AttackResolutionEvaluation } | AttackResolutionFailure;

const nonEmpty = z.string().trim().min(1);
const strings = z.array(nonEmpty).min(1);
export const AttackResolutionConditionSchema: z.ZodType<AttackResolutionCondition> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('target-kind-in'), kinds: strings }).strict(),
  z.object({ kind: z.literal('encounter-kind-in'), kinds: strings }).strict(),
  z.object({ kind: z.literal('target-part-key-in'), partKeys: strings }).strict(),
  z.object({ kind: z.literal('target-health-at-most'), amount: z.number().finite().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('player-counter-at-least'), resourceId: nonEmpty, amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(AttackResolutionConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(AttackResolutionConditionSchema).min(1) }).strict(),
  z.object({ kind: z.literal('not'), condition: AttackResolutionConditionSchema }).strict()
]));
export const AttackResolutionPolicySchema: z.ZodType<AttackResolutionPolicy> = z.object({
  schemaVersion: z.literal(1),
  moduleId: nonEmpty,
  policyId: nonEmpty,
  priority: z.number().finite(),
  ordering: z.literal('explicit-priority'),
  when: AttackResolutionConditionSchema,
  damage: z.object({ kind: z.literal('fixed'), amount: z.number().finite().int().positive() }).strict(),
  encounterPolicy: EncounterPolicyRefSchema,
  reasonCode: EncounterReasonCodeSchema
}).strict();
export const AttackResolutionRegistryFingerprintSchema = z.object({ rulesetVersion: nonEmpty, modules: z.array(z.object({ id: nonEmpty, version: nonEmpty }).strict()) }).strict();
export const AttackResolutionRequestSchema: z.ZodType<AttackResolutionRequest> = z.object({ schemaVersion: z.literal(1), playerId: nonEmpty, targetId: nonEmpty, registry: AttackResolutionRegistryFingerprintSchema }).strict();
export const AttackResolutionEvaluationSchema: z.ZodType<AttackResolutionEvaluation> = z.object({
  schemaVersion: z.literal(1),
  input: AttackResolutionRequestSchema,
  policy: z.object({ moduleId: nonEmpty, policyId: nonEmpty }).strict(),
  combat: CombatEvaluationSchema,
  partyPrefix: z.object({ slotCount: z.number().finite().int().nonnegative(), power: z.number().finite().nonnegative(), participantCardIds: z.array(nonEmpty) }).strict(),
  damage: EnemyTargetDamageEvaluationSchema,
  reasonCode: EncounterReasonCodeSchema
}).strict().superRefine((value, context) => {
  if (value.damage.input.lethalOutcome === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['damage', 'input', 'lethalOutcome'], message: 'Attack resolution damage requires an explicit lethal outcome.' });
});
export const AttackResolutionEventPayloadSchema: z.ZodType<AttackResolutionEventPayload> = z.object({ schemaVersion: z.literal(1), kind: z.literal('attack-resolution'), evaluation: AttackResolutionEvaluationSchema }).strict();

export function validateAttackResolutionPolicy(policy: AttackResolutionPolicy, moduleId: string): string[] {
  const label = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>';
  if (!isFiniteJsonValue(policy)) return [`Attack resolution policy ${label} must contain finite, acyclic JSON-only data.`];
  const parsed = AttackResolutionPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Attack resolution policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (parsed.data.moduleId !== moduleId) errors.push(`Attack resolution policy ${label} must belong to module ${moduleId}.`);
  if (parsed.data.reasonCode.namespace !== parsed.data.moduleId) errors.push(`Attack resolution policy ${label} reason namespace must match module ${parsed.data.moduleId}.`);
  return errors;
}
