import { z } from 'zod';

export type EncounterPolicyRef = { moduleId: string; policyId: string };
export type EncounterRegistryFingerprint = { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
export type EncounterReasonCode = { namespace: string; code: string };

export type EncounterDisposition =
  | { kind: 'removed' }
  | { kind: 'shared-zone'; zoneId: string; position: 'top' | 'bottom'; ordering: 'preserve' | 'reverse' }
  | { kind: 'module-zone'; zoneId: string; position: 'top' | 'bottom'; ordering: 'preserve' | 'reverse' }
  | { kind: 'player-discard'; position: 'top' | 'bottom'; ordering: 'preserve' | 'reverse' };

export type EncounterCompletionCondition =
  | { kind: 'all-targets-defeated' }
  | { kind: 'all-targets-terminal' }
  | { kind: 'required-targets-defeated'; match: 'all' | 'any'; targetIds?: readonly string[] | undefined; partKeys?: readonly string[] | undefined }
  | { kind: 'explicit-only' };

export type EncounterResolutionPolicy = {
  schemaVersion: 1;
  policyId: string;
  moduleId: string;
  priority: number;
  ordering: 'explicit-priority';
  completionCondition: EncounterCompletionCondition;
  defeatedTargetDisposition: EncounterDisposition;
  removedTargetDisposition: EncounterDisposition;
  attachmentDisposition: EncounterDisposition;
  reasonCode: EncounterReasonCode;
};

export type EncounterRef = { encounterId: string; encounterKind: string };
export type EnemyTargetRef = {
  targetId: string;
  cardInstanceId: string;
  targetKind: string;
  parentEncounterId: string;
  partKey?: string | undefined;
};
export type EnemyTargetHealth = { current: number; max: number };
export type EncounterTargetSnapshot = EnemyTargetRef & {
  status: 'available' | 'engaged' | 'defeated' | 'removed';
  attachmentIds: readonly string[];
  health?: EnemyTargetHealth | undefined;
};

export type EncounterDestination =
  | { kind: 'removed' }
  | { kind: 'shared-zone'; zoneId: string; position: 'top' | 'bottom' }
  | { kind: 'module-zone'; moduleId: string; zoneId: string; position: 'top' | 'bottom' }
  | { kind: 'player-discard'; playerId: string; position: 'top' | 'bottom' };
export type EncounterCardSource =
  | { kind: 'enemy-target-card'; targetId: string }
  | { kind: 'enemy-target-attachment'; targetId: string; attachmentIndex: number };
export type EncounterCardMutation = { cardInstanceId: string; source: EncounterCardSource; destination: EncounterDestination };
export type EncounterDestinationMutationPlan = {
  schemaVersion: 1;
  targetId: string;
  targetStatus: 'defeated' | 'removed';
  mutations: readonly EncounterCardMutation[];
};

export type EncounterCompletionEvaluationInput = {
  schemaVersion: 1;
  encounter: EncounterRef;
  fixedTargetIds: readonly string[];
  targets: readonly EncounterTargetSnapshot[];
  policy: EncounterPolicyRef;
  registry: EncounterRegistryFingerprint;
};
export type EncounterCompletionRequest = { schemaVersion: 1; encounterId: string; policy?: EncounterPolicyRef; explicit?: boolean };
export type EncounterCompletionEvaluation = {
  schemaVersion: 1;
  input: EncounterCompletionEvaluationInput;
  completed: boolean;
  alreadyCompleted: boolean;
  reasonCode: EncounterReasonCode;
};

export type EnemyTargetResolutionRequest = {
  schemaVersion: 1;
  targetId: string;
  outcome: 'defeated' | 'removed';
  policy?: EncounterPolicyRef;
};
export type EnemyTargetResolutionEvaluationInput = {
  schemaVersion: 1;
  encounter: EncounterRef;
  target: EnemyTargetRef;
  fixedTargetIds: readonly string[];
  fixedAttachmentIds: readonly string[];
  terminalBefore: boolean;
  terminalAfter: true;
  outcome: 'defeated' | 'removed';
  policy: EncounterPolicyRef;
  registry: EncounterRegistryFingerprint;
};
export type EnemyTargetResolutionEvaluation = {
  schemaVersion: 1;
  input: EnemyTargetResolutionEvaluationInput;
  mutationPlan: EncounterDestinationMutationPlan;
  completion: EncounterCompletionEvaluation;
  reasonCode: EncounterReasonCode;
};

export type EnemyTargetDamageRequest = { schemaVersion: 1; targetId: string; requestedDamage: number; policy?: EncounterPolicyRef; lethalOutcome?: 'defeated' | 'removed' | undefined };
export type EnemyTargetDamageEvaluationInput = {
  schemaVersion: 1;
  encounter: EncounterRef;
  target: EnemyTargetRef;
  fixedTargetIds: readonly string[];
  fixedAttachmentIds: readonly string[];
  healthBefore: EnemyTargetHealth;
  requestedDamage: number;
  lethalOutcome?: 'defeated' | 'removed' | undefined;
  policy: EncounterPolicyRef;
  registry: EncounterRegistryFingerprint;
};
export type EnemyTargetDamageEvaluation = {
  schemaVersion: 1;
  input: EnemyTargetDamageEvaluationInput;
  healthAfter: EnemyTargetHealth;
  actualDamage: number;
  lethal: boolean;
  terminalBefore: boolean;
  terminalAfter: boolean;
  resolution?: EnemyTargetResolutionEvaluation | undefined;
  reasonCode: EncounterReasonCode;
};

/** A replayable, authoritative fact emitted by an encounter Effect AST node. */
export type EncounterEventPayload = {
  schemaVersion: 1;
  kind: 'encounter-resolution';
  action: 'created' | 'target-created' | 'attachment-added' | 'damaged' | 'target-defeated' | 'target-removed' | 'completed';
  encounter: EncounterRef;
  policy: EncounterPolicyRef;
  registry: EncounterRegistryFingerprint;
  target?: EnemyTargetRef | undefined;
  evaluation?: EncounterCompletionEvaluation | EnemyTargetResolutionEvaluation | EnemyTargetDamageEvaluation | undefined;
};

export type EncounterEvaluationFailureCode =
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'UNKNOWN_MODULE'
  | 'UNKNOWN_POLICY'
  | 'UNKNOWN_POLICY_VERSION'
  | 'MISSING_ENCOUNTER_POLICY'
  | 'POLICY_REF_MISMATCH'
  | 'REGISTRY_VERSION_MISMATCH'
  | 'ORDER_POLICY_REQUIRED'
  | 'UNKNOWN_ENCOUNTER'
  | 'UNKNOWN_TARGET'
  | 'UNKNOWN_CARD'
  | 'INVALID_ENCOUNTER_RELATIONSHIP'
  | 'DUPLICATE_ENCOUNTER_ID'
  | 'DUPLICATE_TARGET_ID'
  | 'DUPLICATE_PART_KEY'
  | 'DUPLICATE_ATTACHMENT'
  | 'CARD_LOCATION_CONFLICT'
  | 'INVALID_HEALTH'
  | 'INVALID_DAMAGE'
  | 'TARGET_ALREADY_TERMINAL'
  | 'ENCOUNTER_ALREADY_FINISHED'
  | 'REQUIRED_TARGET_NOT_FOUND'
  | 'REQUIRED_PART_NOT_FOUND'
  | 'INVALID_SOURCE'
  | 'INVALID_DESTINATION'
  | 'COMPLETION_CONDITION_NOT_MET'
  | 'INVALID_INPUT';
export type EncounterEvaluationFailure = {
  status: 'failed' | 'unsupported';
  reason: EncounterEvaluationFailureCode;
  reasonCode: EncounterReasonCode;
  error: string;
};
export type EncounterCompletionResult = { status: 'ready'; evaluation: EncounterCompletionEvaluation } | EncounterEvaluationFailure;
export type EnemyTargetResolutionResult = { status: 'ready'; evaluation: EnemyTargetResolutionEvaluation } | EncounterEvaluationFailure;
export type EnemyTargetDamageResult = { status: 'ready'; evaluation: EnemyTargetDamageEvaluation } | EncounterEvaluationFailure;

const nonEmpty = z.string().trim().min(1);
export const EncounterReasonCodeSchema = z.object({ namespace: nonEmpty, code: nonEmpty }).strict();
export const EncounterPolicyRefSchema = z.object({ moduleId: nonEmpty, policyId: nonEmpty }).strict();
export const EncounterRegistryFingerprintSchema = z.object({ rulesetVersion: nonEmpty, modules: z.array(z.object({ id: nonEmpty, version: nonEmpty }).strict()) }).strict();
export const EnemyTargetHealthSchema = z.object({ current: z.number().finite().int().nonnegative(), max: z.number().finite().int().nonnegative() }).refine(({ current, max }) => current <= max, 'Current health must not exceed maximum health.');
const orderedDestination = { position: z.enum(['top', 'bottom']), ordering: z.enum(['preserve', 'reverse']) } as const;
const disposition: z.ZodType<EncounterDisposition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('removed') }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty, ...orderedDestination }).strict(),
  z.object({ kind: z.literal('module-zone'), zoneId: nonEmpty, ...orderedDestination }).strict(),
  z.object({ kind: z.literal('player-discard'), ...orderedDestination }).strict()
]);
const completionCondition: z.ZodType<EncounterCompletionCondition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all-targets-defeated') }).strict(),
  z.object({ kind: z.literal('all-targets-terminal') }).strict(),
  z.object({ kind: z.literal('required-targets-defeated'), match: z.enum(['all', 'any']), targetIds: z.array(nonEmpty).min(1).optional(), partKeys: z.array(nonEmpty).min(1).optional() }).strict(),
  z.object({ kind: z.literal('explicit-only') }).strict()
]);

export const EncounterResolutionPolicySchema: z.ZodType<EncounterResolutionPolicy> = z.object({
  schemaVersion: z.literal(1),
  policyId: nonEmpty,
  moduleId: nonEmpty,
  priority: z.number().finite(),
  ordering: z.literal('explicit-priority'),
  completionCondition,
  defeatedTargetDisposition: disposition,
  removedTargetDisposition: disposition,
  attachmentDisposition: disposition,
  reasonCode: EncounterReasonCodeSchema
}).strict();

const encounterRefSchema = z.object({ encounterId: nonEmpty, encounterKind: nonEmpty }).strict();
const targetRefSchema = z.object({ targetId: nonEmpty, cardInstanceId: nonEmpty, targetKind: nonEmpty, parentEncounterId: nonEmpty, partKey: nonEmpty.optional() }).strict();
const targetSnapshotSchema = targetRefSchema.extend({ status: z.enum(['available', 'engaged', 'defeated', 'removed']), attachmentIds: z.array(nonEmpty), health: EnemyTargetHealthSchema.optional() }).strict();
const destinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('removed') }).strict(),
  z.object({ kind: z.literal('shared-zone'), zoneId: nonEmpty, position: z.enum(['top', 'bottom']) }).strict(),
  z.object({ kind: z.literal('module-zone'), moduleId: nonEmpty, zoneId: nonEmpty, position: z.enum(['top', 'bottom']) }).strict(),
  z.object({ kind: z.literal('player-discard'), playerId: nonEmpty, position: z.enum(['top', 'bottom']) }).strict()
]);
const sourceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('enemy-target-card'), targetId: nonEmpty }).strict(), z.object({ kind: z.literal('enemy-target-attachment'), targetId: nonEmpty, attachmentIndex: z.number().int().nonnegative() }).strict()]);
export const EncounterDestinationMutationPlanSchema = z.object({ schemaVersion: z.literal(1), targetId: nonEmpty, targetStatus: z.enum(['defeated', 'removed']), mutations: z.array(z.object({ cardInstanceId: nonEmpty, source: sourceSchema, destination: destinationSchema }).strict()) }).strict();
export const EncounterCompletionRequestSchema = z.object({ schemaVersion: z.literal(1), encounterId: nonEmpty, policy: EncounterPolicyRefSchema.optional(), explicit: z.boolean().optional() }).strict();
export const EnemyTargetResolutionRequestSchema = z.object({ schemaVersion: z.literal(1), targetId: nonEmpty, outcome: z.enum(['defeated', 'removed']), policy: EncounterPolicyRefSchema.optional() }).strict();
export const EnemyTargetDamageRequestSchema = z.object({ schemaVersion: z.literal(1), targetId: nonEmpty, requestedDamage: z.number().finite().int().nonnegative(), policy: EncounterPolicyRefSchema.optional(), lethalOutcome: z.enum(['defeated', 'removed']).optional() }).strict();
const completionInputSchema = z.object({ schemaVersion: z.literal(1), encounter: encounterRefSchema, fixedTargetIds: z.array(nonEmpty), targets: z.array(targetSnapshotSchema), policy: EncounterPolicyRefSchema, registry: EncounterRegistryFingerprintSchema }).strict();
export const EncounterCompletionEvaluationSchema = z.object({ schemaVersion: z.literal(1), input: completionInputSchema, completed: z.boolean(), alreadyCompleted: z.boolean(), reasonCode: EncounterReasonCodeSchema }).strict();
const resolutionInputSchema = z.object({ schemaVersion: z.literal(1), encounter: encounterRefSchema, target: targetRefSchema, fixedTargetIds: z.array(nonEmpty), fixedAttachmentIds: z.array(nonEmpty), terminalBefore: z.boolean(), terminalAfter: z.literal(true), outcome: z.enum(['defeated', 'removed']), policy: EncounterPolicyRefSchema, registry: EncounterRegistryFingerprintSchema }).strict();
export const EnemyTargetResolutionEvaluationSchema: z.ZodType<EnemyTargetResolutionEvaluation> = z.object({ schemaVersion: z.literal(1), input: resolutionInputSchema, mutationPlan: EncounterDestinationMutationPlanSchema, completion: EncounterCompletionEvaluationSchema, reasonCode: EncounterReasonCodeSchema }).strict();
const damageInputSchema = z.object({ schemaVersion: z.literal(1), encounter: encounterRefSchema, target: targetRefSchema, fixedTargetIds: z.array(nonEmpty), fixedAttachmentIds: z.array(nonEmpty), healthBefore: EnemyTargetHealthSchema, requestedDamage: z.number().finite().int().nonnegative(), lethalOutcome: z.enum(['defeated', 'removed']).optional(), policy: EncounterPolicyRefSchema, registry: EncounterRegistryFingerprintSchema }).strict();
export const EnemyTargetDamageEvaluationSchema: z.ZodType<EnemyTargetDamageEvaluation> = z.object({ schemaVersion: z.literal(1), input: damageInputSchema, healthAfter: EnemyTargetHealthSchema, actualDamage: z.number().finite().int().nonnegative(), lethal: z.boolean(), terminalBefore: z.boolean(), terminalAfter: z.boolean(), resolution: EnemyTargetResolutionEvaluationSchema.optional(), reasonCode: EncounterReasonCodeSchema }).strict();
export const EncounterEventPayloadSchema: z.ZodType<EncounterEventPayload> = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('encounter-resolution'),
  action: z.enum(['created', 'target-created', 'attachment-added', 'damaged', 'target-defeated', 'target-removed', 'completed']),
  encounter: encounterRefSchema,
  policy: EncounterPolicyRefSchema,
  registry: EncounterRegistryFingerprintSchema,
  target: targetRefSchema.optional(),
  evaluation: z.union([EncounterCompletionEvaluationSchema, EnemyTargetResolutionEvaluationSchema, EnemyTargetDamageEvaluationSchema]).optional()
}).strict();

export function isFiniteJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isFiniteJsonValue(entry, ancestors))
    : Object.values(value as Record<string, unknown>).every((entry) => isFiniteJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function duplicates(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  return values.filter((value) => seen.has(value) || !seen.add(value));
}

export function validateEncounterResolutionPolicy(policy: EncounterResolutionPolicy, moduleId: string): string[] {
  const label = typeof policy === 'object' && policy !== null && 'policyId' in policy ? String(policy.policyId) : '<invalid>';
  if (!isFiniteJsonValue(policy)) return [`Encounter policy ${label} must contain finite, acyclic JSON-serializable data only.`];
  const parsed = EncounterResolutionPolicySchema.safeParse(policy);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `Encounter policy ${label} invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (parsed.data.moduleId !== moduleId) errors.push(`Encounter policy ${label} must belong to module ${moduleId}.`);
  if (parsed.data.reasonCode.namespace !== parsed.data.moduleId) errors.push(`Encounter policy ${label} reason namespace must match module ${parsed.data.moduleId}.`);
  if (parsed.data.completionCondition.kind === 'required-targets-defeated') {
    const condition = parsed.data.completionCondition;
    if (!condition.targetIds?.length && !condition.partKeys?.length) errors.push(`Encounter policy ${label} required-targets-defeated needs target IDs or part keys.`);
    if (duplicates(condition.targetIds).length) errors.push(`Encounter policy ${label} has duplicate required target IDs.`);
    if (duplicates(condition.partKeys).length) errors.push(`Encounter policy ${label} has duplicate required part keys.`);
  }
  return errors;
}
