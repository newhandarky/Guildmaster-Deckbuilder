import { CounterConsentEvaluationSchema, CounterConsentInputSchema, type CounterConsentEvaluation, type CounterConsentInput, type CounterConsentPolicy, type GameState, type PendingCounterConsent } from '@guildmaster/game-protocol';
import { validateRulesetStateCompatibility, type Ruleset } from './ruleset.js';

export type CounterConsentFailureReason =
  | 'INVALID_INPUT'
  | 'UNKNOWN_MODULE'
  | 'UNKNOWN_POLICY'
  | 'REGISTRY_VERSION_MISMATCH'
  | 'COUNTER_NOT_FOUND'
  | 'COUNTER_NOT_CONSENT_GATED'
  | 'REQUESTER_NOT_COUNTER_OWNER'
  | 'NO_PENDING_REQUEST'
  | 'REQUEST_ID_MISMATCH'
  | 'ACTOR_NOT_ELIGIBLE'
  | 'ACTOR_ALREADY_ACCEPTED'
  | 'CANCEL_NOT_AUTHORIZED'
  | 'EXPIRATION_NOT_AUTHORIZED';
export type CounterConsentResult = { status: 'ready'; evaluation: CounterConsentEvaluation } | { status: 'failed'; reason: CounterConsentFailureReason; error: string };

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const registryFor = (state: GameState, ruleset: Ruleset) => ({ rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) });
const fail = (reason: CounterConsentFailureReason, error: string): CounterConsentResult => ({ status: 'failed', reason, error });
const findPolicy = (ruleset: Ruleset, ref: { moduleId: string; policyId: string }): CounterConsentPolicy | undefined => ruleset.modules.find(({ id }) => id === ref.moduleId)?.counterConsentPolicies?.find(({ policyId }) => policyId === ref.policyId);

function validateRegistry(state: GameState, ruleset: Ruleset, input: CounterConsentInput): CounterConsentResult | undefined {
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility) return fail('REGISTRY_VERSION_MISMATCH', compatibility);
  const expected = registryFor(state, ruleset);
  if (!same(input.registry, expected)) return fail('REGISTRY_VERSION_MISMATCH', 'Counter consent registry fingerprint mismatch.');
  return undefined;
}

function evaluation(input: CounterConsentInput, pending: Pick<PendingCounterConsent, 'policy' | 'counterOwnerId' | 'requesterId' | 'requiredActorIds' | 'acceptedActorIds'>, status: CounterConsentEvaluation['status'], reasonCode: CounterConsentEvaluation['reasonCode'], acceptedActorIds = pending.acceptedActorIds): CounterConsentResult {
  const value: CounterConsentEvaluation = { schemaVersion: 1, input: structuredClone(input), policy: structuredClone(pending.policy), counterOwnerId: pending.counterOwnerId, requesterId: pending.requesterId, requiredActorIds: [...pending.requiredActorIds], acceptedActorIds: [...acceptedActorIds], status, reasonCode };
  return CounterConsentEvaluationSchema.safeParse(value).success ? { status: 'ready', evaluation: value } : fail('INVALID_INPUT', 'Counter consent evaluation is malformed.');
}

export function evaluateCounterConsent(state: GameState, ruleset: Ruleset, input: CounterConsentInput): CounterConsentResult {
  const parsed = CounterConsentInputSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT', `Malformed counter consent input: ${parsed.error.issues[0]?.message ?? 'invalid input'}.`);
  input = parsed.data;
  const registryError = validateRegistry(state, ruleset, input);
  if (registryError) return registryError;
  if (input.action === 'request') {
    const module = ruleset.modules.find(({ id }) => id === input.policy.moduleId);
    if (!module) return fail('UNKNOWN_MODULE', `Unknown counter consent Rules Module: ${input.policy.moduleId}.`);
    const policy = findPolicy(ruleset, input.policy);
    if (!policy) return fail('UNKNOWN_POLICY', `Unknown counter consent policy: ${input.policy.moduleId}/${input.policy.policyId}.`);
    if (input.actorId !== input.counterOwnerId) return fail('REQUESTER_NOT_COUNTER_OWNER', 'Only the counter owner may request consent.');
    const owner = state.players.find(({ id }) => id === input.counterOwnerId);
    const counter = owner?.counters.find(({ resourceId }) => resourceId === policy.resourceId);
    if (!counter) return fail('COUNTER_NOT_FOUND', `Counter ${policy.resourceId} does not exist for ${input.counterOwnerId}.`);
    if (counter.visibility !== 'allPlayersByConsent') return fail('COUNTER_NOT_CONSENT_GATED', `Counter ${policy.resourceId} is not gated by all-player consent.`);
    const request = { policy: input.policy, counterOwnerId: input.counterOwnerId, requesterId: input.actorId, requiredActorIds: state.players.map(({ id }) => id).filter((id) => id !== input.actorId), acceptedActorIds: [] };
    return evaluation(input, request, request.requiredActorIds.length ? 'requested' : 'accepted', request.requiredActorIds.length ? 'CONSENT_REQUESTED' : 'ALL_REQUIRED_ACTORS_ACCEPTED');
  }
  const pending = state.effectState.pendingCounterConsent;
  if (!pending) return fail('NO_PENDING_REQUEST', 'No counter consent request is pending.');
  if (pending.requestId !== input.requestId) return fail('REQUEST_ID_MISMATCH', 'Counter consent requestId does not match the pending request.');
  if (!same(input.registry, pending.registry)) return fail('REGISTRY_VERSION_MISMATCH', 'Counter consent pending registry fingerprint mismatch.');
  const module = ruleset.modules.find(({ id }) => id === pending.policy.moduleId);
  if (!module) return fail('UNKNOWN_MODULE', `Unknown counter consent Rules Module: ${pending.policy.moduleId}.`);
  const policy = findPolicy(ruleset, pending.policy);
  if (!policy) return fail('UNKNOWN_POLICY', `Unknown counter consent policy: ${pending.policy.moduleId}/${pending.policy.policyId}.`);
  if (input.action === 'accept' || input.action === 'decline') {
    if (!pending.requiredActorIds.includes(input.actorId)) return fail('ACTOR_NOT_ELIGIBLE', 'Actor is not a required counter consent responder.');
    if (pending.acceptedActorIds.includes(input.actorId)) return fail('ACTOR_ALREADY_ACCEPTED', 'Actor already accepted this counter consent request.');
    if (input.action === 'decline') return evaluation(input, pending, 'declined', 'REQUIRED_ACTOR_DECLINED');
    const accepted = [...pending.acceptedActorIds, input.actorId];
    const complete = pending.requiredActorIds.every((id) => accepted.includes(id));
    return evaluation(input, pending, complete ? 'accepted' : 'pending', complete ? 'ALL_REQUIRED_ACTORS_ACCEPTED' : 'ACCEPT_RECORDED', accepted);
  }
  if (input.action === 'cancel') {
    if (input.actorId !== pending.requesterId) return fail('CANCEL_NOT_AUTHORIZED', 'Only the counter consent requester may cancel.');
    return evaluation(input, pending, 'cancelled', 'REQUESTER_CANCELLED');
  }
  if (policy.expiration.actor === 'requester' && input.actorId !== pending.requesterId) return fail('EXPIRATION_NOT_AUTHORIZED', 'Only the requester may expire this counter consent request.');
  if (!state.players.some(({ id }) => id === input.actorId)) return fail('EXPIRATION_NOT_AUTHORIZED', 'Only a game player may expire this counter consent request.');
  return evaluation(input, pending, 'expired', 'REQUEST_EXPIRED');
}

export function validatePendingCounterConsentState(state: GameState, ruleset: Ruleset): string | undefined {
  const pending = state.effectState.pendingCounterConsent;
  if (!pending) return undefined;
  const registry = registryFor(state, ruleset);
  if (!same(pending.registry, registry)) return 'Counter consent registry fingerprint mismatch.';
  const policy = findPolicy(ruleset, pending.policy);
  if (!policy) return `Unknown counter consent policy: ${pending.policy.moduleId}/${pending.policy.policyId}.`;
  const owner = state.players.find(({ id }) => id === pending.counterOwnerId);
  if (!owner || pending.requesterId !== pending.counterOwnerId) return 'Counter consent owner or requester is invalid.';
  const counter = owner.counters.find(({ resourceId }) => resourceId === policy.resourceId);
  if (!counter || counter.visibility !== 'allPlayersByConsent') return 'Counter consent target is missing or no longer consent-gated.';
  const expectedActors = state.players.map(({ id }) => id).filter((id) => id !== pending.requesterId);
  if (
    !pending.requiredActorIds.length
    || !same(pending.requiredActorIds, expectedActors)
    || new Set(pending.acceptedActorIds).size !== pending.acceptedActorIds.length
    || pending.acceptedActorIds.some((id) => !pending.requiredActorIds.includes(id))
    || pending.requiredActorIds.every((id) => pending.acceptedActorIds.includes(id))
  ) return 'Counter consent responder set is invalid.';
  return undefined;
}
