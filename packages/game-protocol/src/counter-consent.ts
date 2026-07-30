import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';

export type CounterConsentPolicy = {
  schemaVersion: 1;
  moduleId: string;
  policyId: string;
  resourceId: string;
  requester: 'counter-owner';
  requiredConsent: 'all-other-players';
  expiration: { kind: 'explicit-command'; actor: 'requester' | 'any-player' };
};
export type CounterConsentPolicyRef = { moduleId: string; policyId: string };
export type CounterConsentRegistryFingerprint = { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
export type CounterConsentAction = 'request' | 'accept' | 'decline' | 'cancel' | 'expire';
export type CounterConsentStatus = 'requested' | 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type CounterConsentReasonCode =
  | 'CONSENT_REQUESTED'
  | 'ACCEPT_RECORDED'
  | 'ALL_REQUIRED_ACTORS_ACCEPTED'
  | 'REQUIRED_ACTOR_DECLINED'
  | 'REQUESTER_CANCELLED'
  | 'REQUEST_EXPIRED';
export type CounterConsentInput =
  | { schemaVersion: 1; action: 'request'; actorId: string; requestId: string; executionId: string; counterOwnerId: string; policy: CounterConsentPolicyRef; registry: CounterConsentRegistryFingerprint }
  | { schemaVersion: 1; action: Exclude<CounterConsentAction, 'request'>; actorId: string; requestId: string; registry: CounterConsentRegistryFingerprint };
export type CounterConsentEvaluation = {
  schemaVersion: 1;
  input: CounterConsentInput;
  policy: CounterConsentPolicyRef;
  counterOwnerId: string;
  requesterId: string;
  requiredActorIds: readonly string[];
  acceptedActorIds: readonly string[];
  status: CounterConsentStatus;
  reasonCode: CounterConsentReasonCode;
};
export type CounterConsentEventPayload = { schemaVersion: 1; kind: 'counter-consent'; evaluation: CounterConsentEvaluation };

const nonEmpty = z.string().trim().min(1);
const policyRef = z.object({ moduleId: nonEmpty, policyId: nonEmpty }).strict();
const registry = z.object({ rulesetVersion: nonEmpty, modules: z.array(z.object({ id: nonEmpty, version: nonEmpty }).strict()) }).strict();
export const CounterConsentPolicySchema: z.ZodType<CounterConsentPolicy> = z.object({
  schemaVersion: z.literal(1),
  moduleId: nonEmpty,
  policyId: nonEmpty,
  resourceId: nonEmpty,
  requester: z.literal('counter-owner'),
  requiredConsent: z.literal('all-other-players'),
  expiration: z.object({ kind: z.literal('explicit-command'), actor: z.enum(['requester', 'any-player']) }).strict()
}).strict();
export const CounterConsentInputSchema: z.ZodType<CounterConsentInput> = z.discriminatedUnion('action', [
  z.object({ schemaVersion: z.literal(1), action: z.literal('request'), actorId: nonEmpty, requestId: nonEmpty, executionId: nonEmpty, counterOwnerId: nonEmpty, policy: policyRef, registry }).strict(),
  z.object({ schemaVersion: z.literal(1), action: z.enum(['accept', 'decline', 'cancel', 'expire']), actorId: nonEmpty, requestId: nonEmpty, registry }).strict()
]);
export const CounterConsentEvaluationSchema: z.ZodType<CounterConsentEvaluation> = z.object({
  schemaVersion: z.literal(1),
  input: CounterConsentInputSchema,
  policy: policyRef,
  counterOwnerId: nonEmpty,
  requesterId: nonEmpty,
  requiredActorIds: z.array(nonEmpty),
  acceptedActorIds: z.array(nonEmpty),
  status: z.enum(['requested', 'pending', 'accepted', 'declined', 'cancelled', 'expired']),
  reasonCode: z.enum(['CONSENT_REQUESTED', 'ACCEPT_RECORDED', 'ALL_REQUIRED_ACTORS_ACCEPTED', 'REQUIRED_ACTOR_DECLINED', 'REQUESTER_CANCELLED', 'REQUEST_EXPIRED'])
}).strict();
export const CounterConsentEventPayloadSchema: z.ZodType<CounterConsentEventPayload> = z.object({ schemaVersion: z.literal(1), kind: z.literal('counter-consent'), evaluation: CounterConsentEvaluationSchema }).strict();

export function validateCounterConsentPolicy(policy: CounterConsentPolicy, moduleId: string): string[] {
  if (!isFiniteJsonValue(policy)) return ['Counter consent policy must contain finite, acyclic, plain JSON data only.'];
  const parsed = CounterConsentPolicySchema.safeParse(policy);
  if (!parsed.success) return parsed.error.issues.map((issue) => `Counter consent policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  return parsed.data.moduleId === moduleId ? [] : [`Counter consent policy ${parsed.data.policyId} must belong to module ${moduleId}.`];
}
